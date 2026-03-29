import { mat3 } from 'gl-matrix';

/**
 * Lumina Pro - Professional Projection Mapping Tool
 * Core Logic
 */

class MappingArea {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.shape = 'rect'; // 'rect' or 'circle'
    this.opacity = 1.0;
    this.active = false;
    
    // TL, TR, BR, BL order
    this.points = [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 }
    ];
    
    this.dragIndex = -1;
    this.sourceMode = 'capture'; // 'capture' or 'file'
    this.source = null; // { type: 'video' | 'image', url: string, name: string }
    this.mediaElement = null;
    this.visible = true;
  }
}

class ProjectionApp {
  constructor() {
    this.areas = [];
    this.selectedAreaId = null;
    this.stream = null;
    this.outputWindow = null;
    this.channel = new BroadcastChannel('lumina-pro');
    
    this.canvas = document.getElementById('control-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.video = document.getElementById('input-video');
    this.mediaCache = new Map(); // id -> HTMLMediaElement
    this.showGrid = true; // Alignment mode by default
    
    this.init();
    this.loadSettings();
    this.animate();
    
    // Expose for output window access
    window.projectionApp = this;
  }

  init() {
    this.bindEvents();
    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());
  }

  handleResize() {
    const container = this.canvas.parentElement;
    this.canvas.width = container.clientWidth;
    this.canvas.height = container.clientHeight;
  }

  bindEvents() {
    document.getElementById('btn-capture-screen').addEventListener('click', () => this.startCapture());
    document.getElementById('btn-open-output').addEventListener('click', () => this.openOutput());
    document.getElementById('btn-copy-url').addEventListener('click', () => {
       const url = new URL('/output.html', window.location.origin).href;
       navigator.clipboard.writeText(url).then(() => {
          alert('出力画面のURLをコピーしたよ！プロジェクター側のブラウザで開いてね。');
       });
    });
    document.getElementById('btn-add-area').addEventListener('click', () => this.addArea());
    document.getElementById('btn-delete-area').addEventListener('click', () => this.deleteSelectedArea());
    
    // Test mode toggle
    const btnProject = document.getElementById('btn-project');
    btnProject.addEventListener('click', () => {
       this.showGrid = !this.showGrid;
       btnProject.innerHTML = this.showGrid ? '<span class="icon">🔍</span> 調整モード' : '<span class="icon">🎭</span> 投影モード';
       btnProject.classList.toggle('active', this.showGrid);
       this.sync();
    });
    
    document.getElementById('opacity-slider').addEventListener('input', (e) => {
      if (this.selectedAreaId !== null) {
        const area = this.areas.find(a => a.id === this.selectedAreaId);
        if (area) area.opacity = parseFloat(e.target.value);
        this.sync();
      }
    });

    document.querySelectorAll('.shape-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const shape = e.target.dataset.shape;
        if (this.selectedAreaId !== null) {
          const area = this.areas.find(a => a.id === this.selectedAreaId);
          if (area) area.shape = shape;
          
          document.querySelectorAll('.shape-toggle').forEach(b => b.classList.remove('active'));
          e.target.classList.add('active');
          this.sync();
        }
      });
    });

    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    window.addEventListener('mouseup', () => this.handleMouseUp());

    // File source events
    const fileInput = document.getElementById('file-input');
    document.getElementById('btn-set-source').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
    
    // Toggle source mode
    document.querySelectorAll('.source-type-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mode = e.target.dataset.sourceType;
        if (this.selectedAreaId !== null) {
          const area = this.areas.find(a => a.id === this.selectedAreaId);
          if (area) area.sourceMode = mode;
          this.selectArea(area.id);
          this.sync();
        }
      });
    });

    document.getElementById('btn-toggle-visible').addEventListener('click', () => {
      if (this.selectedAreaId !== null) {
        const area = this.areas.find(a => a.id === this.selectedAreaId);
        if (area) {
          area.visible = !area.visible;
          this.sync();
          this.selectArea(area.id);
        }
      }
    });
  }

  handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file || this.selectedAreaId === null) return;

    const area = this.areas.find(a => a.id === this.selectedAreaId);
    if (!area) return;

    const url = URL.createObjectURL(file);
    const type = file.type.startsWith('video/') ? 'video' : 'image';
    
    area.source = { type, url, name: file.name };
    
    // Create side media element
    let el;
    if (type === 'video') {
       el = document.createElement('video');
       el.src = url;
       el.loop = true;
       el.muted = true;
       el.play();
       el.onloadeddata = () => this.sync();
    } else {
       el = document.createElement('img');
       el.src = url;
       el.onload = () => {
          this.sync();
          this.render(); // Ensure preview updates
       };
    }
    
    this.mediaCache.set(area.id, el);
    this.selectArea(area.id); // Refresh UI
    this.sync();
  }


  async startCapture() {
    if (this.stream) {
      this.stopCapture();
      return;
    }
    
    try {
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" },
        audio: false
      });
      this.video.srcObject = this.stream;
      this.video.play();
      
      // Expose for popup directly
      window.projectionStream = this.stream;
      
      const btn = document.getElementById('btn-capture-screen');
      btn.innerHTML = '<span class="icon">⏹️</span> キャプチャ停止';
      btn.classList.replace('primary', 'secondary');
      
      // Listen for when user stops via browser UI
      this.stream.getVideoTracks()[0].onended = () => this.stopCapture();
      
      this.sync();
    } catch (err) {
      console.error("Error: " + err);
    }
  }

  stopCapture() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
      window.projectionStream = null;
      this.video.srcObject = null;
    }
    
    const btn = document.getElementById('btn-capture-screen');
    btn.innerHTML = '<span class="icon">🖥️</span> キャプチャ開始';
    btn.classList.replace('secondary', 'primary');
    this.sync();
  }

  openOutput() {
    const w = screen.width;
    const h = screen.height;
    this.outputWindow = window.open('/output.html', 'LuminaOutput', `width=${w},height=${h},menubar=no,toolbar=no,location=no,status=no`);
    
    // Sync state immediately when child opens
    setTimeout(() => this.sync(), 1000);
  }

  addArea() {
    const id = Date.now();
    const area = new MappingArea(id, `レイヤー ${this.areas.length + 1}`);
    this.areas.push(area);
    this.selectArea(id);
    this.updateLayersUI();
    this.sync();
  }

  deleteSelectedArea() {
    if (this.selectedAreaId === null) return;
    this.areas = this.areas.filter(a => a.id !== this.selectedAreaId);
    this.selectedAreaId = this.areas.length > 0 ? this.areas[0].id : null;
    this.updateLayersUI();
    this.sync();
  }

  selectArea(id) {
    this.selectedAreaId = id;
    this.areas.forEach(a => a.active = (a.id === id));
    
    const settings = document.getElementById('area-settings');
    if (id !== null) {
      settings.classList.remove('hidden');
      const area = this.areas.find(a => a.id === id);
      document.getElementById('opacity-slider').value = area.opacity;
      document.querySelectorAll('.shape-toggle').forEach(b => {
        b.classList.toggle('active', b.dataset.shape === area.shape);
      });

      // Update source labels & UI
      const sourceName = document.getElementById('source-name');
      const fileControls = document.getElementById('file-source-controls');
      const visibleBtn = document.getElementById('btn-toggle-visible');
      
      document.querySelectorAll('.source-type-toggle').forEach(b => {
         b.classList.toggle('active', b.dataset.sourceType === area.sourceMode);
      });

      visibleBtn.innerHTML = area.visible ? '<span class="icon">👁️</span>' : '<span class="icon">🚫</span>';
      visibleBtn.style.color = area.visible ? 'var(--text-color)' : 'var(--danger-color)';

      if (area.sourceMode === 'file') {
         fileControls.classList.remove('hidden');
         sourceName.textContent = area.source ? area.source.name : '未選択';
      } else {
         fileControls.classList.add('hidden');
      }
    } else {
      settings.classList.add('hidden');
    }
    this.updateLayersUI();
  }

  updateLayersUI() {
    const container = document.getElementById('mapping-layers');
    container.innerHTML = '';
    this.areas.forEach(area => {
      const item = document.createElement('div');
      item.className = `layer-item ${area.id === this.selectedAreaId ? 'active' : ''}`;
      const isVisible = area.visible;
      item.innerHTML = `
        <div class="flex-row flex-1">
          <span class="icon">${area.shape === 'rect' ? '⬛' : '⚪'}</span>
          <span>${area.name}</span>
        </div>
        <span class="icon" style="opacity: 0.5">${isVisible ? '👁️' : '🚫'}</span>
      `;
      item.onclick = () => this.selectArea(area.id);
      container.appendChild(item);
    });
  }

  handleMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.canvas.width;
    const y = (e.clientY - rect.top) / this.canvas.height;
    
    // Check points of all areas (active one first for priority)
    const sortedAreas = [...this.areas].sort((a, b) => (a.id === this.selectedAreaId ? -1 : 1));
    
    for (const area of sortedAreas) {
      for (let i = 0; i < area.points.length; i++) {
        const p = area.points[i];
        const dist = Math.hypot(p.x - x, p.y - y);
        if (dist < 0.03) {
          this.selectArea(area.id);
          area.dragIndex = i;
          return;
        }
      }
    }
    
    this.selectArea(null);
  }

  handleMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / this.canvas.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / this.canvas.height));
    
    const area = this.areas.find(a => a.dragIndex !== -1);
    if (area) {
      area.points[area.dragIndex].x = x;
      area.points[area.dragIndex].y = y;
      this.sync();
    }
  }

  handleMouseUp() {
    this.areas.forEach(a => a.dragIndex = -1);
  }

  sync() {
    const data = {
      areas: this.areas.map(a => ({
        id: a.id,
        shape: a.shape,
        opacity: a.opacity,
        points: a.points,
        sourceMode: a.sourceMode,
        hasSource: !!a.source,
        sourceType: a.source ? a.source.type : null,
        sourceUrl: a.source ? a.source.url : null,
        visible: a.visible
      })),
      hasStream: !!this.stream,
      showGrid: this.showGrid
    };
    
    // Save to local storage for persistence
    localStorage.setItem('lumina-pro-settings', JSON.stringify(data.areas));
    
    this.channel.postMessage(data);
  }

  loadSettings() {
    const saved = localStorage.getItem('lumina-pro-settings');
    if (saved) {
      try {
        const areasData = JSON.parse(saved);
        this.areas = areasData.map((d, i) => {
           const area = new MappingArea(d.id, `レイヤー ${i + 1}`);
           area.shape = d.shape;
           area.opacity = d.opacity;
           area.points = d.points;
           area.sourceMode = d.sourceMode || 'capture';
           area.visible = d.visible !== undefined ? d.visible : true;
           return area;
        });
        
        if (this.areas.length > 0) {
          this.selectArea(this.areas[0].id);
        } else {
          this.addArea();
        }
      } catch (e) {
        console.error("Failed to load settings", e);
        this.addArea();
      }
    } else {
      // Add initial area if no settings found
      this.addArea();
    }
    this.updateLayersUI();
  }

  animate() {
    this.render();
    requestAnimationFrame(() => this.animate());
  }

  render() {
    const { ctx, canvas, video } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw background (dark grid)
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let i = 0; i < canvas.width; i += 40) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, canvas.height); ctx.stroke();
    }
    for (let i = 0; i < canvas.height; i += 40) {
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(canvas.width, i); ctx.stroke();
    }

    // Draw video inside mapped areas (using simple canvas clipping/warping)
    this.areas.forEach(area => {
      if (area.visible) this.drawArea(area);
    });
  }

  drawArea(area) {
    const { ctx, canvas, video } = this;
    const w = canvas.width;
    const h = canvas.height;
    
    ctx.save();
    
    // Path for clipping/highlighting
    ctx.beginPath();
    area.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x * w, p.y * h);
      else ctx.lineTo(p.x * w, p.y * h);
    });
    ctx.closePath();

    // Render either the global stream or the local source
    const areaMedia = area.sourceMode === 'file' ? this.mediaCache.get(area.id) : null;
    const hasActiveSource = areaMedia || (area.sourceMode === 'capture' && this.stream);

    if (hasActiveSource) {
      const sourceEl = areaMedia || video;
      
      ctx.save();
      ctx.globalAlpha = area.opacity;
      ctx.clip();
      
      const minX = Math.min(...area.points.map(p => p.x)) * w;
      const minY = Math.min(...area.points.map(p => p.y)) * h;
      const maxX = Math.max(...area.points.map(p => p.x)) * w;
      const maxY = Math.max(...area.points.map(p => p.y)) * h;
      
      ctx.drawImage(sourceEl, minX, minY, maxX - minX, maxY - minY);
      ctx.restore();
    }

    // Draw interaction UI
    ctx.lineWidth = 2;
    ctx.strokeStyle = area.id === this.selectedAreaId ? '#3b82f6' : '#94a3b8';
    ctx.stroke();

    if (area.id === this.selectedAreaId) {
      area.points.forEach((p, i) => {
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    }
    
    ctx.restore();
  }
}

new ProjectionApp();
