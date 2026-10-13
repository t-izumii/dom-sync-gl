/**
 * ポインタの軌跡から波紋が広がり、その傾きで画面が屈折するエフェクト。
 *
 * 移植元は re3 の水面レイヤー（`Water`）のうち、波動方程式の波紋
 * （`SimpleFluidSim`）の部分。原典は流体の法線と半々に混ぜてから使うので、
 * 単体では「流体が無い所での原典の見た目」と同じになるよう、上向きの
 * 法線と半々に混ぜる。流体は `FluidWaterEffect` として別にしてあり、
 * 重ねて使える（重ねた順に屈折が掛かるため、原典の 1 枚の水面とは厳密には
 * 一致しない）。
 *
 * @see ./waveSim.ts
 * @see ../fluidWater/fluidWaterEffect.ts
 */
import * as THREE from 'three/webgpu';
import {
  abs,
  clamp,
  float,
  floor,
  mix,
  normalize,
  pow,
  screenSize,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import type GUI from 'lil-gui';
import { BaseEffect, type BaseEffectConfig } from '../../index';
import { WaveSim } from './waveSim';

/**
 * MirroredRepeatWrapping と同じ折り返し。原典は屈折元の画面コピーを鏡映しで
 * 繰り返すので、画面の外を読んでも縁の画素が引き伸ばされない。
 */
const mirrorRepeat = (q: Node): Node => {
  const m = q.sub(floor(q.mul(0.5)).mul(2));
  return float(1).sub(abs(m.sub(1)));
};

export interface WaterRippleEffectOptions {
  /** 高さ場の解像度（画面の CSS px に対する比） */
  resolution?: number;
  /** 1 刻み（1/60 秒）ごとに高さへ掛ける係数 */
  damping?: number;
  /** 波紋を起こす線の太さ（UV） */
  trailSize?: number;
  /** 傾きに掛ける倍率。大きいほど屈折が強い */
  strength?: number;
  /** 傾いた所に足す青み */
  blueness?: number;
  opacity?: number;
}

export class WaterRippleEffect extends BaseEffect {
  public resolution: number;
  public damping: number;
  public trailSize: number;
  public strength: number;
  public blueness: number;
  public opacity: number;

  private renderer: THREE.WebGPURenderer | null = null;
  private wave: WaveSim | null = null;

  private readonly _tWave = texture();
  private readonly _uInterpolation = uniform(0);
  private readonly _uStrength = uniform(1);
  private readonly _uBlueness = uniform(0.02);
  private readonly _uOpacity = uniform(1);

  private _lastTime = -1;
  private readonly _lastMouse = new THREE.Vector2();

  constructor(options: WaterRippleEffectOptions = {}) {
    super();
    this.resolution = options.resolution ?? 0.5;
    this.damping = options.damping ?? 0.98;
    this.trailSize = options.trailSize ?? 0.035;
    this.strength = options.strength ?? 1;
    this.blueness = options.blueness ?? 0.02;
    this.opacity = options.opacity ?? 1;
  }

  _setRenderer(renderer: THREE.WebGPURenderer): void {
    this.renderer = renderer;
    this.wave = new WaveSim(renderer, this.uTime);
  }

  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: ({ inputTexture, uv }) => {
        const height = (q: Node): Node => {
          const s = this._tWave.sample(q);
          return mix(s.y, s.x, this._uInterpolation);
        };
        // 原典は dFdx / dFdy で 1 画素あたりの傾きを取る。WebGL の画面座標は
        // +y が上なので、左上原点の uv では上の画素は -y 側になる
        const px = vec2(1).div(screenSize);
        const h = height(uv);
        const slope = vec2(
          height(uv.add(vec2(px.x, 0))).sub(h),
          height(uv.sub(vec2(0, px.y))).sub(h),
        ).mul(this._uStrength);
        // 上向きの法線 (0, 1, 0) と半々に混ぜて正規化したものと同じ
        const n = normalize(vec3(slope.x, 1, slope.y));

        // n.z は原典の画面座標（+y が上）での向きなので、左上原点の uv へは反転して足す
        const refracted = inputTexture.sample(mirrorRepeat(uv.add(vec2(n.x, n.z.negate()))));
        const blue = clamp(n.x, 0, 1).add(clamp(n.z.negate(), 0, 1)).mul(this._uBlueness);
        const water = vec4(refracted.rgb.add(vec3(0, 0, blue)), refracted.a);

        // 画面の縁ほど薄くする（中央でほぼ 1）
        const v = uv.mul(uv.oneMinus()).mul(0.99).add(0.005);
        const alpha = clamp(pow(v.x.mul(v.y).mul(16), 1.1).mul(this._uOpacity), 0, 1);
        return mix(inputTexture, water, alpha);
      },
      uniforms: {
        uStrength: this._uStrength,
        uBlueness: this._uBlueness,
        uOpacity: this._uOpacity,
      },
    };
  }

  update(time: number): void {
    const { wave } = this;
    if (!this.pass || !this.renderer || !wave) return;

    // 原典の Tick と同じく 30fps 相当で頭打ちにする
    const dt = this._lastTime < 0 ? 0 : Math.min(Math.max(time - this._lastTime, 0), 1 / 30);
    this._lastTime = time;

    // 原典はポインタイベントのたびに波を足す印を立てる。ここでは位置が
    // 変わったフレームをイベントがあったフレームとみなす
    const mouse = this.uMouse.value;
    if (!mouse.equals(this._lastMouse)) wave.notifyPointer();
    this._lastMouse.copy(mouse);

    wave.step(dt, mouse, { damping: this.damping, trailSize: this.trailSize });

    this._tWave.value = wave.texture ?? this._tWave.value;
    this._uInterpolation.value = wave.interpolation;
    this._uStrength.value = this.strength;
    this._uBlueness.value = this.blueness;
    this._uOpacity.value = this.opacity;
  }

  resize(width: number, height: number): void {
    this.wave?.buildFramebuffers(width, height, this.resolution);
    this._tWave.value = this.wave?.texture ?? this._tWave.value;
  }

  resume(time: number, mouse: THREE.Vector2): void {
    // 非表示中に動いた分を、復帰した瞬間の長い一筆として足さない
    this._lastTime = time;
    this._lastMouse.copy(mouse);
    this.wave?.resetPointer(mouse);
  }

  setupGUI(gui: GUI): GUI {
    const folder = gui.addFolder('水面の波紋 (Water ripple)');
    folder.add(this, 'enabled').name('有効');
    folder
      .add(this, 'resolution', 0.25, 1, 0.05)
      .name('解像度（画面比）')
      .onFinishChange(() => this.resize(this.width, this.height));
    folder.add(this, 'damping', 0.9, 0.999, 0.001).name('減衰');
    folder.add(this, 'trailSize', 0.01, 0.1, 0.001).name('線の太さ');
    folder.add(this, 'strength', 0, 4, 0.05).name('屈折の強さ');
    folder.add(this, 'blueness', 0, 0.1, 0.001).name('青み');
    folder.add(this, 'opacity', 0, 1, 0.01).name('不透明度');
    return folder;
  }

  dispose(): void {
    this.wave?.dispose();
    this.wave = null;
    this.renderer = null;
    this.pass = null;
  }
}
