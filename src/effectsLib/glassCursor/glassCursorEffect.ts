/**
 * ポインタに遅れて付いてくる丸いガラス板のカーソル。ガラス越しの背景が
 * 縁で屈折し、外周の細いリング・回転する内側リング・中央の星が重なる。
 *
 * 移植元は re3 の `TestCursor`（DOM + SVG フィルタの liquid glass）。
 * 寸法・フィルタ値・追従率は移植元の既定値に合わせてある。post effect に
 * したため、屈折して見えるのは canvas に描かれた内容だけになる。
 *
 * @see ./glassCursorNode.ts
 */
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { UniformNode } from 'three/webgpu';
import type GUI from 'lil-gui';
import { BaseEffect, type BaseEffectConfig } from '../../index';
import { BASE_SIZE, glassCursorNode } from './glassCursorNode';

export interface GlassCursorEffectOptions {
  /** ガラスの直径（CSS px）。リングと星も比例して大きくなる */
  size?: number;
  /** 60fps 換算で 1 フレームに目標へ近づく割合 */
  followSpeed?: number;
  /** ガラスと画面端の最小余白（CSS px） */
  edgeOffset?: number;
  /** 屈折の強さの倍率 */
  refraction?: number;
  /** ガラス越しのぼかし（CSS px） */
  blur?: number;
  contrast?: number;
  brightness?: number;
  saturate?: number;
  /** 外周リングの不透明度 */
  ringOpacity?: number;
  /** 内側リングが 1 回転する秒数 */
  rotationPeriod?: number;
  showStar?: boolean;
  /** 表示倍率。リンクにホバー中は縮める、といった切り替えに使う */
  scale?: number;
  opacity?: number;
}

/** scale / opacity の追従の時定数（秒）。移植元の CSS transition 300ms に寄せた値 */
const TRANSITION_TIME = 0.1;

export class GlassCursorEffect extends BaseEffect {
  public size: number;
  public followSpeed: number;
  public edgeOffset: number;
  public refraction: number;
  public blur: number;
  public contrast: number;
  public brightness: number;
  public saturate: number;
  public ringOpacity: number;
  public rotationPeriod: number;
  public showStar: boolean;
  public scale: number;
  public opacity: number;

  private readonly _uViewport = uniform(new THREE.Vector2(1, 1));
  private readonly _uCenter = uniform(new THREE.Vector2());
  private readonly _uSize = uniform(BASE_SIZE);
  private readonly _uScale = uniform(1);
  private readonly _uOpacity = uniform(0);
  private readonly _uRefraction = uniform(1);
  private readonly _uBlur = uniform(1);
  private readonly _uContrast = uniform(1);
  private readonly _uBrightness = uniform(1);
  private readonly _uSaturate = uniform(1);
  private readonly _uRingOpacity = uniform(1);
  private readonly _uAngle = uniform(0);
  private readonly _uStarOpacity = uniform(1);

  private readonly _target = new THREE.Vector2();
  private _x = 0;
  private _y = 0;
  private _scale: number;
  private _opacity = 0;
  private _angle = 0;
  private _shown = false;
  private _lastTime = 0;
  private _hasLastTime = false;

  constructor(options: GlassCursorEffectOptions = {}) {
    super();
    this.size = options.size ?? BASE_SIZE;
    this.followSpeed = options.followSpeed ?? 0.18;
    this.edgeOffset = options.edgeOffset ?? 10;
    this.refraction = options.refraction ?? 1;
    this.blur = options.blur ?? 1;
    this.contrast = options.contrast ?? 1.2;
    this.brightness = options.brightness ?? 1.05;
    this.saturate = options.saturate ?? 1.1;
    this.ringOpacity = options.ringOpacity ?? 0.64;
    this.rotationPeriod = options.rotationPeriod ?? 4;
    this.showStar = options.showStar ?? true;
    this.scale = options.scale ?? 1;
    this.opacity = options.opacity ?? 1;
    this._scale = this.scale;
  }

  protected getConfig(): BaseEffectConfig {
    const uniforms = {
      uSize: this._uSize,
      uRefraction: this._uRefraction,
      uBlur: this._uBlur,
      uContrast: this._uContrast,
      uBrightness: this._uBrightness,
      uSaturate: this._uSaturate,
      uRingOpacity: this._uRingOpacity,
    };
    return {
      outputNode: (ctx) =>
        glassCursorNode(ctx, {
          ...uniforms,
          uViewport: this._uViewport,
          uCenter: this._uCenter,
          uScale: this._uScale,
          uOpacity: this._uOpacity,
          uAngle: this._uAngle,
          uStarOpacity: this._uStarOpacity,
        }),
      uniforms: uniforms as Record<string, UniformNode<unknown>>,
    };
  }

  update(time: number): void {
    if (!this.pass) return;

    const dt = this._hasLastTime ? Math.min(Math.max(time - this._lastTime, 0), 0.1) : 0;
    this._lastTime = time;
    this._hasLastTime = true;

    const mouse = this.uMouse.value;
    const target = this._clampCenter(mouse.x * this.width, mouse.y * this.height);
    // 最初にマウスが動くまでは出さない。マウス位置の初期値（画面中央）に
    // ガラスが居座らないよう、現れる瞬間に目標位置へ合わせておく
    if (!this._shown) {
      this._shown = this.mouseMotion.move > 0;
      this._x = target.x;
      this._y = target.y;
    }

    const follow = 1 - Math.pow(1 - Math.min(Math.max(this.followSpeed, 0), 1), dt * 60);
    this._x += (target.x - this._x) * follow;
    this._y += (target.y - this._y) * follow;

    const ease = 1 - Math.exp(-dt / TRANSITION_TIME);
    this._scale += (this.scale - this._scale) * ease;
    this._opacity += ((this._shown ? this.opacity : 0) - this._opacity) * ease;
    this._angle =
      (this._angle + (dt * Math.PI * 2) / Math.max(this.rotationPeriod, 0.1)) % (Math.PI * 2);

    this._uCenter.value.set(this._x, this._y);
    this._uScale.value = this._scale;
    this._uOpacity.value = this._opacity;
    this._uAngle.value = this._angle;
    this._uStarOpacity.value = this.showStar ? 1 : 0;
    this._uSize.value = this.size;
    this._uRefraction.value = this.refraction;
    this._uBlur.value = this.blur;
    this._uContrast.value = this.contrast;
    this._uBrightness.value = this.brightness;
    this._uSaturate.value = this.saturate;
    this._uRingOpacity.value = this.ringOpacity;
  }

  /** 移植元の `clampPosition` と同じく、ガラス全体が画面端から edgeOffset 内に収まるよう制限する */
  private _clampCenter(x: number, y: number): THREE.Vector2 {
    const margin = this.size / 2 + this.edgeOffset;
    return this._target.set(
      Math.max(margin, Math.min(this.width - margin, x)),
      Math.max(margin, Math.min(this.height - margin, y)),
    );
  }

  resize(width: number, height: number): void {
    this._uViewport.value.set(width, height);
    const clamped = this._clampCenter(this._x, this._y);
    this._x = clamped.x;
    this._y = clamped.y;
  }

  resume(): void {
    this._hasLastTime = false;
  }

  setupGUI(gui: GUI): GUI {
    const folder = gui.addFolder('グラスカーソル (Glass cursor)');
    folder.add(this, 'enabled').name('有効');
    folder.add(this, 'size', 16, 160, 1).name('直径 (px)');
    folder.add(this, 'followSpeed', 0.01, 1, 0.01).name('追従率');
    folder.add(this, 'refraction', 0, 4, 0.05).name('屈折の強さ');
    folder.add(this, 'blur', 0, 6, 0.1).name('ぼかし (px)');
    folder.add(this, 'contrast', 0.5, 2, 0.01).name('コントラスト');
    folder.add(this, 'brightness', 0.5, 2, 0.01).name('明るさ');
    folder.add(this, 'saturate', 0, 3, 0.01).name('彩度');
    folder.add(this, 'ringOpacity', 0, 1, 0.01).name('外周リングの不透明度');
    folder.add(this, 'rotationPeriod', 0.5, 20, 0.1).name('リングの回転周期 (秒)');
    folder.add(this, 'showStar').name('星を表示');
    folder.add(this, 'scale', 0.25, 2, 0.01).name('表示倍率');
    folder.add(this, 'opacity', 0, 1, 0.01).name('不透明度');
    return folder;
  }

  dispose(): void {
    this.pass = null;
  }
}
