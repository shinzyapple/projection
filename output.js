import { mat3, vec3 } from 'gl-matrix';

/**
 * Lumina Pro - Output Engine
 * High Performance WebGL Perspective Warp with Homography
 */

class OutputApp {
  constructor() {
    this.canvas = document.getElementById('output-canvas');
    this.gl = this.canvas.getContext('webgl', { alpha: false, preserveDrawingBuffer: true });
    this.video = document.getElementById('input-video');
    this.channel = new BroadcastChannel('lumina-pro');
    this.areas = [];
    this.localMediaCache = new Map(); // url -> el
    this.showGrid = true;
    
    this.initGL();
    this.bindEvents();
    this.initFullscreen();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.animate();
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.gl.viewport(0, 0, this.gl.drawingBufferWidth, this.gl.drawingBufferHeight);
  }

  initGL() {
    const gl = this.gl;
    const vsSource = `
      attribute vec2 aPosition;
      attribute vec2 aTexCoord;
      varying vec2 vTexCoord;
      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
        vTexCoord = aTexCoord;
      }
    `;

    // Perspective-correct texture mapping or Grid pattern
    const fsSource = `
      precision mediump float;
      uniform sampler2D uSampler;
      uniform float uOpacity;
      uniform bool uIsCircle;
      uniform bool uIsGrid;
      varying vec2 vTexCoord;
      void main() {
        if (uIsCircle) {
           float d = distance(vTexCoord, vec2(0.5, 0.5));
           if (d > 0.5) discard;
        }
        if (uIsGrid) {
          float stepSize = 0.1;
          float thickness = 0.02;
          vec2 grid = abs(fract(vTexCoord / stepSize - 0.5) - 0.5) / (thickness / stepSize);
          float line = min(grid.x, grid.y);
          float isEdge = (vTexCoord.x < 0.01 || vTexCoord.x > 0.99 || vTexCoord.y < 0.01 || vTexCoord.y > 0.99) ? 1.0 : 0.0;
          float val = 1.0 - smoothstep(0.0, 1.0, line);
          val = max(val, isEdge);
          gl_FragColor = vec4(1.0, 1.0, 1.0, val * 0.8 * uOpacity); // White grid
          return;
        }
        vec4 color = texture2D(uSampler, vTexCoord);
        gl_FragColor = vec4(color.rgb, color.a * uOpacity);
      }
    `;

    const shaderProgram = this.initShaderProgram(gl, vsSource, fsSource);
    this.programInfo = {
      program: shaderProgram,
      attribLocations: {
        position: gl.getAttribLocation(shaderProgram, 'aPosition'),
        texCoord: gl.getAttribLocation(shaderProgram, 'aTexCoord'),
      },
      uniformLocations: {
        sampler: gl.getUniformLocation(shaderProgram, 'uSampler'),
        opacity: gl.getUniformLocation(shaderProgram, 'uOpacity'),
        isCircle: gl.getUniformLocation(shaderProgram, 'uIsCircle'),
        isGrid: gl.getUniformLocation(shaderProgram, 'uIsGrid'),
      },
    };

    this.positionBuffer = gl.createBuffer();
    this.texCoordBuffer = gl.createBuffer();
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  initShaderProgram(gl, vs, fs) {
    const vShader = this.loadShader(gl, gl.VERTEX_SHADER, vs);
    const fShader = this.loadShader(gl, gl.FRAGMENT_SHADER, fs);
    const prog = gl.createProgram();
    gl.attachShader(prog, vShader);
    gl.attachShader(prog, fShader);
    gl.linkProgram(prog);
    return prog;
  }

  loadShader(gl, type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return s;
  }

  bindEvents() {
    this.channel.onmessage = (e) => {
      this.areas = e.data.areas;
      this.showGrid = e.data.showGrid;
      
      if (e.data.hasStream) {
        if (!this.video.srcObject) this.syncStream();
      } else {
        this.video.srcObject = null;
      }

      // Manage local media cache
      this.areas.forEach(area => {
         if (area.sourceMode === 'file' && area.sourceUrl) {
            if (!this.localMediaCache.has(area.sourceUrl)) {
               this.createLocalMedia(area);
            }
         }
      });
    };
    
    // Check for stream every 2 seconds if not connected
    setInterval(() => {
        if (!this.video.srcObject) this.syncStream();
    }, 2000);
  }

  initFullscreen() {
    this.canvas.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(e => {
          console.error(`Error attempting to enable full-screen mode: ${e.message} (${e.name})`);
        });
      }
    });

    // Hide tip after a few seconds
    setTimeout(() => {
        const tip = document.getElementById('tip');
        if (tip) tip.style.opacity = '0';
    }, 5000);
  }

  syncStream() {
    if (window.opener && window.opener.projectionStream) {
       this.video.srcObject = window.opener.projectionStream;
       this.video.play().catch(() => {});
    }
  }

  createLocalMedia(area) {
     const url = area.sourceUrl;
     const type = area.sourceType;
     let el;
     
     if (type === 'video') {
        el = document.createElement('video');
        el.src = url;
        el.loop = true;
        el.muted = true;
        el.playsInline = true;
        el.crossOrigin = "anonymous";
        el.play().catch(() => {
           console.log("Autoplay blocked, waiting for interaction");
        });
     } else {
        el = document.createElement('img');
        el.crossOrigin = "anonymous";
        el.src = url;
     }
     this.localMediaCache.set(url, el);
  }

  animate() {
    this.render();
    requestAnimationFrame(() => this.animate());
  }

  render() {
    const gl = this.gl;
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.programInfo.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.areas.forEach(area => {
      if (!area.visible) return; // Skip hidden layers

      let sourceMedia = null;
      
      // 1. Try layer-specific source (Local cache in this window)
      if (!this.showGrid && area.sourceMode === 'file' && area.sourceUrl) {
          sourceMedia = this.localMediaCache.get(area.sourceUrl);
      }
      
      // 2. Fallback to global screen capture
      if (!this.showGrid && !sourceMedia && area.sourceMode === 'capture' && this.video.readyState >= this.video.HAVE_CURRENT_DATA) {
          sourceMedia = this.video;
      }

      // Check if media is actually ready to be drawn
      let isReady = false;
      if (sourceMedia) {
         if (sourceMedia instanceof HTMLVideoElement) {
            isReady = sourceMedia.readyState >= sourceMedia.HAVE_CURRENT_DATA;
            // Force play if paused
            if (sourceMedia.paused && !this.showGrid) sourceMedia.play().catch(() => {});
         } else if (sourceMedia instanceof HTMLImageElement) {
            isReady = sourceMedia.complete;
         }
      }

      if (isReady && !this.showGrid) {
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceMedia);
        
        gl.uniform1i(this.programInfo.uniformLocations.isGrid, 0);
        gl.uniform1f(this.programInfo.uniformLocations.opacity, area.opacity);
        this.drawArea(area);
      } else if (this.showGrid) {
        // Draw grid in alignment mode
        gl.uniform1i(this.programInfo.uniformLocations.isGrid, 1);
        gl.uniform1f(this.programInfo.uniformLocations.opacity, 1.0); // Full opacity for grid
        this.drawArea(area);
      } else {
        // Show black in projection mode if media not ready yet
        // No draw or draw a black rectangle
      }
    });
  }

  drawArea(area) {
    const gl = this.gl;
    const pts = area.points;
    
    // To support true perspective warping in a single quad with WebGL, 
    // we use "perspective correct" interpolation. 
    // We subdivide the quad into several triangles to reduce the "kink" 
    // OR we use the homography approach.
    // For simplicity and high quality, I'll use a subdivided grid (4x4)
    // for each mapping area.
    
    const rows = 10;
    const cols = 10;
    const vertices = [];
    const uvs = [];

    const getPoint = (u, v) => {
      // Bilinear interpolation between the 4 corners
      // pts: 0:TL, 1:TR, 2:BR, 3:BL
      const topX = pts[0].x + u * (pts[1].x - pts[0].x);
      const topY = pts[0].y + u * (pts[1].y - pts[0].y);
      const bottomX = pts[3].x + u * (pts[2].x - pts[3].x);
      const bottomY = pts[3].y + u * (pts[2].y - pts[3].y);
      
      const x = topX + v * (bottomX - topX);
      const y = topY + v * (bottomY - topY);
      
      return {
        x: x * 2.0 - 1.0,
        y: (1.0 - y) * 2.0 - 1.0
      };
    };

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const u1 = i / cols;
        const v1 = j / rows;
        const u2 = (i + 1) / cols;
        const v2 = (j + 1) / rows;

        const p1 = getPoint(u1, v1);
        const p2 = getPoint(u2, v1);
        const p3 = getPoint(u2, v2);
        const p4 = getPoint(u1, v2);

        vertices.push(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
        vertices.push(p1.x, p1.y, p3.x, p3.y, p4.x, p4.y);
        
        uvs.push(u1, v1, u2, v1, u2, v2);
        uvs.push(u1, v1, u2, v2, u1, v2);
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.vertexAttribPointer(this.programInfo.attribLocations.position, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(this.programInfo.attribLocations.position);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
    gl.vertexAttribPointer(this.programInfo.attribLocations.texCoord, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(this.programInfo.attribLocations.texCoord);

    gl.uniform1f(this.programInfo.uniformLocations.opacity, area.opacity);
    gl.uniform1i(this.programInfo.uniformLocations.isCircle, area.shape === 'circle' ? 1 : 0);

    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
  }
}

new OutputApp();
