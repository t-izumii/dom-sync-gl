import * as THREE from 'three/webgpu';

export interface TrailTextureOptions {
  size?: number;
  maxAge?: number;
  radius?: number;
  intensity?: number;
  interpolate?: number;
  minForce?: number;
  blend?: GlobalCompositeOperation;
  smoothing?: number;
  ease?: (t: number) => number;
}

interface TrailPoint {
  x: number;
  y: number;
  age: number;
  force: number;
}

const easeCircleOut = (x: number): number => Math.sqrt(1 - Math.pow(x - 1, 2));
export class TrailTexture {
  readonly texture: THREE.CanvasTexture;
  readonly size: number;

  public maxAge: number;
  public radius: number;
  public intensity: number;
  public interpolate: number;
  public minForce: number;
  public blend: GlobalCompositeOperation;
  public smoothing: number;
  public ease: (t: number) => number;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private trail: TrailPoint[] = [];
  private force = 0;
  private _disposed = false;

  constructor(options: TrailTextureOptions = {}) {
    this.size = Math.max(8, Math.floor(options.size ?? 128));
    this.maxAge = options.maxAge ?? 750;
    this.radius = options.radius ?? 0.3;
    this.intensity = options.intensity ?? 0.2;
    this.interpolate = options.interpolate ?? 0;
    this.minForce = options.minForce ?? 0.3;
    this.blend = options.blend ?? 'screen';
    this.smoothing = options.smoothing ?? 0.5;
    this.ease = options.ease ?? easeCircleOut;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = this.size;
    const ctx = this.canvas.getContext('2d');
    if (ctx === null) {
      throw new Error('[TrailTexture] 2D コンテキストを取得できません。');
    }
    this.ctx = ctx;
    this.ctx.fillStyle = 'black';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.texture = new THREE.CanvasTexture(this.canvas);
  }

  addTouch(uv: THREE.Vector2): void {
    if (this._disposed) return;

    const last = this.trail[this.trail.length - 1];
    if (last) {
      const dx = last.x - uv.x;
      const dy = last.y - uv.y;
      const dd = dx * dx + dy * dy;

      const force = Math.max(this.minForce, Math.min(dd * 10000, 1));
      this.force = this.force * this.smoothing + force * (1 - this.smoothing);

      if (this.interpolate > 0) {
        const spacing = Math.max(1e-6, (this.radius * 0.5) / this.interpolate);
        const lines = Math.min(512, Math.ceil(Math.sqrt(dd) / spacing));
        if (lines > 1) {
          for (let i = 1; i < lines; i++) {
            this.trail.push({
              x: last.x - (dx / lines) * i,
              y: last.y - (dy / lines) * i,
              age: 0,
              force,
            });
          }
        }
      }
    }
    this.trail.push({ x: uv.x, y: uv.y, age: 0, force: this.force });
  }

  update(dt: number): void {
    if (this._disposed) return;

    this.clearCanvas();

    const ageMs = dt * 1000;
    const alive: TrailPoint[] = [];
    for (const point of this.trail) {
      point.age += ageMs;
      if (point.age <= this.maxAge) alive.push(point);
    }
    this.trail = alive;
    if (this.trail.length === 0) this.force = 0;

    for (const point of this.trail) {
      this.drawTouch(point);
    }
    this.texture.needsUpdate = true;
  }

  clear(): void {
    if (this._disposed) return;
    this.trail = [];
    this.force = 0;
    this.clearCanvas();
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.trail = [];
    this.texture.dispose();
  }

  private clearCanvas(): void {
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = 'black';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private drawTouch(point: TrailPoint): void {
    const pos = {
      x: point.x * this.size,
      y: (1 - point.y) * this.size,
    };

    let intensity = 1;
    if (point.age < this.maxAge * 0.3) {
      intensity = this.ease(point.age / (this.maxAge * 0.3));
    } else {
      intensity = this.ease(1 - (point.age - this.maxAge * 0.3) / (this.maxAge * 0.7));
    }
    intensity *= point.force;

    this.ctx.globalCompositeOperation = this.blend;

    const radius = this.size * this.radius * intensity;
    const grd = this.ctx.createRadialGradient(
      pos.x,
      pos.y,
      Math.max(0, radius * 0.25),
      pos.x,
      pos.y,
      Math.max(0, radius)
    );
    grd.addColorStop(0, `rgba(255, 255, 255, ${this.intensity})`);
    grd.addColorStop(1, 'rgba(0, 0, 0, 0.0)');

    this.ctx.beginPath();
    this.ctx.fillStyle = grd;
    this.ctx.arc(pos.x, pos.y, Math.max(0, radius), 0, Math.PI * 2);
    this.ctx.fill();
  }
}
