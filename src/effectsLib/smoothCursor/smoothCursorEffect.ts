import * as THREE from 'three/webgpu';
import { uniform, uniformArray } from 'three/tsl';
import type { UniformNode } from 'three/webgpu';
import type GUI from 'lil-gui';
import { BaseEffect, type BaseEffectConfig } from '../../index';
import { smoothCursorNode } from './smoothCursorNode';

const MAX_POINTS = 64;

export interface SmoothCursorEffectOptions {
  pointsCount?: number;
  springStrength?: number;
  dampening?: number;
  smoothFactor?: number;
  lineWidth?: number;
  glow?: number;
  velocityScale?: number;
  trailOpacity?: number;
  color?: string;
  idleFadeDelay?: number;
}

export class SmoothCursorEffect extends BaseEffect {
  public pointsCount: number;
  public springStrength: number;
  public dampening: number;
  public smoothFactor: number;
  public lineWidth: number;
  public glow: number;
  public velocityScale: number;
  public trailOpacity: number;
  public readonly color: THREE.Color;
  public blendMode: 'screen' | 'add' = 'screen';

  private readonly _px = new Float32Array(MAX_POINTS);
  private readonly _py = new Float32Array(MAX_POINTS);
  private readonly _vx = new Float32Array(MAX_POINTS);
  private readonly _vy = new Float32Array(MAX_POINTS);

  private readonly _pointsUniform: THREE.Vector4[] = Array.from(
    { length: MAX_POINTS },
    () => new THREE.Vector4(0.5, 0.5, 0, 0),
  );

  private readonly _uPoints = uniformArray(this._pointsUniform, 'vec4');
  private readonly _uCount = uniform(2, 'int');
  private readonly _uColor: UniformNode<THREE.Color>;
  private readonly _uGlow = uniform(1);
  private readonly _uAspect = uniform(1);
  private readonly _uBlendMode = uniform(0, 'int');

  private _lastTime = 0;
  private _hasLastTime = false;
  private readonly _prevMouse = new THREE.Vector2();
  private _hasPrevMouse = false;

  private _presence = 0;
  private _idleTime = Infinity;
  private readonly _idleFadeDelay: number;

  private _height = 1;
  private _aspect = 1;

  private readonly _maxDelta = 0.2;

  constructor(options: SmoothCursorEffectOptions = {}) {
    super();
    this.pointsCount = options.pointsCount ?? 40;
    this.springStrength = options.springStrength ?? 0.4;
    this.dampening = options.dampening ?? 0.5;
    this.smoothFactor = options.smoothFactor ?? 1;
    this.lineWidth = options.lineWidth ?? 0.3;
    this.glow = options.glow ?? 1;
    this.velocityScale = options.velocityScale ?? 1;
    this.trailOpacity = options.trailOpacity ?? 0.8;
    this.color = new THREE.Color(options.color ?? '#ffffff');
    this._idleFadeDelay = options.idleFadeDelay ?? 2;

    this._uColor = uniform(this.color);
    this._uCount.value = Math.min(Math.max(Math.round(this.pointsCount), 2), MAX_POINTS);
    this._uGlow.value = this.glow;

    this._px.fill(0.5);
    this._py.fill(0.5);
  }

  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: (ctx) =>
        smoothCursorNode(ctx, {
          uPoints: this._uPoints,
          uCount: this._uCount,
          uColor: this._uColor,
          uGlow: this._uGlow,
          uAspect: this._uAspect,
          uBlendMode: this._uBlendMode,
        }),
      uniforms: {
        uCount: this._uCount,
        uColor: this._uColor,
        uGlow: this._uGlow,
        uAspect: this._uAspect,
        uBlendMode: this._uBlendMode,
      },
    };
  }

  update(time: number, mouse?: THREE.Vector2): void {
    if (!this.pass) return;

    const dt = this._hasLastTime ? Math.min(Math.max(time - this._lastTime, 0), 1 / 30) : 0;
    this._lastTime = time;
    this._hasLastTime = true;

    const f = Math.min(dt * 60, 2);

    const m = mouse ?? this._prevMouse;

    if (!this._hasPrevMouse) {
      this._resetPoints(m.x, m.y);
      this._prevMouse.copy(m);
      this._hasPrevMouse = true;
    }

    const delta = m.distanceTo(this._prevMouse);
    if (delta > this._maxDelta) {
      this._resetPoints(m.x, m.y);
    }

    if (delta > 1e-5) this._idleTime = 0;
    else this._idleTime += dt;
    const presenceTarget = this._idleTime < this._idleFadeDelay ? 1 : 0;
    this._presence += (presenceTarget - this._presence) * (1 - Math.pow(0.85, f));

    this._prevMouse.copy(m);

    const damp = Math.pow(
      Math.min(Math.max(this.dampening, 0.1), 0.99),
      f,
    );
    const px = this._px;
    const py = this._py;
    const vx = this._vx;
    const vy = this._vy;
    for (let i = 0; i < MAX_POINTS; i++) {
      const tx = i === 0 ? m.x : px[i - 1];
      const ty = i === 0 ? m.y : py[i - 1];
      const k = (i === 0 ? this.springStrength * 0.4 : this.springStrength) * f;
      vx[i] += (tx - px[i]) * k;
      vy[i] += (ty - py[i]) * k;
      vx[i] *= damp;
      vy[i] *= damp;
      const sp = Math.hypot(vx[i], vy[i]);
      if (sp > 2) {
        const s = 2 / sp;
        vx[i] *= s;
        vy[i] *= s;
      }
      px[i] += vx[i] * f;
      py[i] += vy[i] * f;
    }

    this._writeUniforms();

    this.setUniform('uCount', Math.min(Math.max(Math.round(this.pointsCount), 2), MAX_POINTS));
    this.setUniform('uGlow', this.glow);
    this.setUniform('uBlendMode', this.blendMode === 'add' ? 1 : 0);
  }

  private _writeUniforms(): void {
    const count = Math.min(Math.max(Math.round(this.pointsCount), 2), MAX_POINTS);
    const alpha = this._presence * this.trailOpacity;
    const s = Math.min(Math.max(this.smoothFactor, 0), 1) * 0.5;

    for (let i = 0; i < count; i++) {
      let x = this._px[i];
      let y = this._py[i];
      if (i > 0 && i < count - 1) {
        x += ((this._px[i - 1] + this._px[i + 1]) * 0.5 - x) * s;
        y += ((this._py[i - 1] + this._py[i + 1]) * 0.5 - y) * s;
      }

      let velFactor = 1;
      if (this.velocityScale > 0) {
        const speedPx = Math.hypot(this._vx[i], this._vy[i]) * this._height;
        velFactor = 1 + Math.min(0.5 * this.velocityScale * speedPx, 2);
      }
      const widthPx = this.lineWidth * (count - i) * velFactor;
      const halfWidthUv = (0.5 * widthPx) / this._height;

      this._pointsUniform[i].set(x, y, halfWidthUv, alpha);
    }
  }

  private _resetPoints(x: number, y: number): void {
    this._px.fill(x);
    this._py.fill(y);
    this._vx.fill(0);
    this._vy.fill(0);
  }

  resize(width: number, height: number): void {
    this._height = Math.max(height, 1);
    this._aspect = width / Math.max(height, 1);
    this._uAspect.value = this._aspect;
  }

  setupGUI(gui: GUI): GUI {
    const folder = gui.addFolder('スムーズカーソル (Smooth cursor)');
    folder.add(this, 'enabled').name('有効');
    folder.add(this, 'pointsCount', 2, MAX_POINTS, 1).name('ポイント数');
    folder.add(this, 'springStrength', 0.05, 1, 0.01).name('ばね強さ');
    folder.add(this, 'dampening', 0.1, 0.99, 0.01).name('減衰（揺れ残り）');
    folder.add(this, 'smoothFactor', 0, 1, 0.01).name('スムーズ係数');
    folder.add(this, 'lineWidth', 0.05, 2, 0.01).name('線幅');
    folder.add(this, 'glow', 0, 4, 0.05).name('発光幅');
    folder.add(this, 'velocityScale', 0, 3, 0.05).name('速度→太さ');
    folder.add(this, 'trailOpacity', 0, 1, 0.01).name('不透明度');
    folder.addColor(this, 'color').name('色');
    folder.add(this, 'blendMode', ['screen', 'add']).name('合成モード');
    return folder;
  }

  dispose(): void {
    this.pass = null;
  }
}
