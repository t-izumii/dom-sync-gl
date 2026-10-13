/**
 * ポインタでかき混ぜた流体越しに画面が屈折し、流れの縁が白く光るエフェクト。
 *
 * 移植元は re3 の水面レイヤー（`Water`）のうち、Navier–Stokes 流体
 * （`WaterFluidSim`）の部分。密度の勾配を法線にして屈折させ、法線の変化量を
 * 発光として足す。原典が重ねている波動方程式の波紋（`SimpleFluidSim`）は
 * `WaterRippleEffect` として別にしてある。
 *
 * 既定値は、原典のタイムラインがサイトの大半の区間で取る値に合わせてある。
 *
 * @see ./waterFluidSim.ts
 * @see ../waterRipple/waterRippleEffect.ts
 */
import * as THREE from 'three/webgpu';
import {
  abs,
  clamp,
  dot,
  float,
  floor,
  mix,
  normalize,
  pow,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { Node, UniformNode } from 'three/webgpu';
import type GUI from 'lil-gui';
import { BaseEffect, type BaseEffectConfig } from '../../index';
import { WaterFluidSim } from './waterFluidSim';

export interface FluidWaterEffectOptions {
  /** 流体の総画素数の上限。原典はデスクトップ 2^18・モバイル 2^16 */
  pixelBudget?: number;
  /** 渦度閉じ込めの強さ */
  curl?: number;
  pressureIterations?: number;
  /** 速度に毎フレーム掛ける係数 */
  velocityDissipation?: number;
  /** 密度に毎フレーム掛ける係数 */
  densityDissipation?: number;
  /** ポインタの軌跡に載せるガウス分布の広さ（UV の 2 乗） */
  splatRadius?: number;
  /** ポインタの移動量（UV）に掛ける倍率 */
  splatForce?: number;
  /** 密度の勾配を法線にするときの効き。大きいほど屈折が強い */
  normalEpsilon?: number;
  emission?: number;
  /** 発光の色味を抜いて白に寄せる割合 */
  emissionWhiteness?: number;
  color?: string;
  opacity?: number;
}

/**
 * MirroredRepeatWrapping と同じ折り返し。原典は屈折元の画面コピーを鏡映しで
 * 繰り返すので、画面の外を読んでも縁の画素が引き伸ばされない。
 */
const mirrorRepeat = (q: Node): Node => {
  const m = q.sub(floor(q.mul(0.5)).mul(2));
  return float(1).sub(abs(m.sub(1)));
};

/** 移動とみなす最小のポインタ移動量（UV） */
const MOVE_EPSILON = 1e-4;

export class FluidWaterEffect extends BaseEffect {
  public pixelBudget: number;
  public curl: number;
  public pressureIterations: number;
  public velocityDissipation: number;
  public densityDissipation: number;
  public splatRadius: number;
  public splatForce: number;
  public normalEpsilon: number;
  public emission: number;
  public emissionWhiteness: number;
  public readonly color: THREE.Color;
  public opacity: number;

  private renderer: THREE.WebGPURenderer | null = null;
  private fluid: WaterFluidSim | null = null;

  private readonly _tNormal = texture();
  private readonly _tNormalDelta = texture();
  private readonly _uEmission = uniform(2.5);
  private readonly _uEmissionWhiteness = uniform(0);
  private readonly _uColor: UniformNode<THREE.Color>;
  private readonly _uOpacity = uniform(1);

  private _lastTime = -1;
  private readonly _prevSplat = new THREE.Vector2();
  private _hasPrevSplat = false;

  constructor(options: FluidWaterEffectOptions = {}) {
    super();
    this.pixelBudget = options.pixelBudget ?? 2 ** 18;
    this.curl = options.curl ?? 10;
    this.pressureIterations = options.pressureIterations ?? 2;
    this.velocityDissipation = options.velocityDissipation ?? 0.99;
    this.densityDissipation = options.densityDissipation ?? 0.97;
    this.splatRadius = options.splatRadius ?? 0.0015;
    this.splatForce = options.splatForce ?? 1e4;
    this.normalEpsilon = options.normalEpsilon ?? 0.1;
    // 原典は発光 5 に「1 − 波紋の割合（0.5）」を掛けている。波紋を外しても
    // 見た目が変わらないよう、掛けた後の値を既定にする
    this.emission = options.emission ?? 2.5;
    this.emissionWhiteness = options.emissionWhiteness ?? 0;
    this.color = new THREE.Color().setStyle(options.color ?? '#ffffff', THREE.NoColorSpace);
    this.opacity = options.opacity ?? 1;
    this._uColor = uniform(this.color.clone().convertSRGBToLinear());
  }

  _setRenderer(renderer: THREE.WebGPURenderer): void {
    this.renderer = renderer;
    this.fluid = new WaterFluidSim(renderer);
  }

  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: ({ inputTexture, uv }) => {
        // 法線が 0 ベクトルになる初回などに normalize が NaN を返さないようにする
        const n = normalize(this._tNormal.sample(uv).xyz.add(vec3(0, 1e-6, 0)));
        // n.z は原典の画面座標（+y が上）での向きなので、左上原点の uv へは反転して足す
        const refracted = inputTexture.sample(mirrorRepeat(uv.add(vec2(n.x, n.z.negate()))));

        const delta = this._tNormalDelta.sample(uv).xyz;
        const luma = dot(delta, vec3(0.2126, 0.7152, 0.0722));
        const emission = mix(delta, vec3(luma), this._uEmissionWhiteness)
          .mul(this._uEmission)
          .mul(this._uColor);
        const water = vec4(refracted.rgb.add(emission), refracted.a);

        // 画面の縁ほど薄くする（中央でほぼ 1）
        const v = uv.mul(uv.oneMinus()).mul(0.99).add(0.005);
        const alpha = clamp(pow(v.x.mul(v.y).mul(16), 1.1).mul(this._uOpacity), 0, 1);
        return mix(inputTexture, water, alpha);
      },
      uniforms: {
        uEmission: this._uEmission,
        uEmissionWhiteness: this._uEmissionWhiteness,
        uColor: this._uColor as UniformNode<unknown>,
        uOpacity: this._uOpacity,
      },
    };
  }

  update(time: number): void {
    const { fluid } = this;
    if (!this.pass || !this.renderer || !fluid) return;

    // 原典の Tick と同じく 30fps 相当で頭打ちにする
    const dt = this._lastTime < 0 ? 0 : Math.min(Math.max(time - this._lastTime, 0), 1 / 30);
    this._lastTime = time;

    const mouse = this.uMouse.value;
    // 前回かき混ぜた位置から一定以上動いたときだけ線分を引く。
    // 小さな動きは溜めて、閾値を超えた時点でまとめて足す
    let pointer = null;
    if (!this._hasPrevSplat) {
      this._prevSplat.copy(mouse);
      this._hasPrevSplat = true;
    } else if (mouse.distanceTo(this._prevSplat) > MOVE_EPSILON) {
      pointer = {
        x: mouse.x,
        y: mouse.y,
        prevX: this._prevSplat.x,
        prevY: this._prevSplat.y,
        force: this.splatForce,
        radius: this.splatRadius,
      };
      this._prevSplat.copy(mouse);
    }

    fluid.step(
      dt,
      {
        curl: this.curl,
        pressureIterations: this.pressureIterations,
        velocityDissipation: this.velocityDissipation,
        densityDissipation: this.densityDissipation,
        pressureDecay: 0.99,
        normalEpsilon: this.normalEpsilon,
      },
      pointer,
    );

    this._bindTextures();
    this._uEmission.value = this.emission;
    this._uEmissionWhiteness.value = this.emissionWhiteness;
    this._uColor.value.copy(this.color).convertSRGBToLinear();
    this._uOpacity.value = this.opacity;
  }

  /**
   * 合成パスが読む texture を実体に向ける。初回の描画より前（resize）にも
   * 呼ぶのは、2 つが同じ仮の texture を指したまま描画が組まれるのを避けるため。
   */
  private _bindTextures(): void {
    this._tNormal.value = this.fluid?.normalTexture ?? this._tNormal.value;
    this._tNormalDelta.value = this.fluid?.normalDeltaTexture ?? this._tNormalDelta.value;
  }

  resize(width: number, height: number): void {
    this.fluid?.buildFramebuffers(width, height, this.pixelBudget);
    this._bindTextures();
  }

  resume(time: number, mouse: THREE.Vector2): void {
    // 非表示中に動いた分を、復帰した瞬間の巨大な一筆として足さない
    this._lastTime = time;
    this._prevSplat.copy(mouse);
  }

  setupGUI(gui: GUI): GUI {
    const folder = gui.addFolder('水面の流体 (Fluid water)');
    folder.add(this, 'enabled').name('有効');
    const rebuild = () => this.resize(this.width, this.height);

    const sim = folder.addFolder('流体');
    sim.add(this, 'pixelBudget', { '2^16': 2 ** 16, '2^17': 2 ** 17, '2^18': 2 ** 18, '2^19': 2 ** 19 })
      .name('解像度（総画素数）')
      .onFinishChange(rebuild);
    sim.add(this, 'curl', 0, 50, 0.5).name('渦度 (curl)');
    sim.add(this, 'pressureIterations', 1, 20, 1).name('圧力反復');
    sim.add(this, 'velocityDissipation', 0.9, 1, 0.001).name('速度の残り方');
    sim.add(this, 'densityDissipation', 0.9, 1, 0.001).name('密度の残り方');
    sim.add(this, 'splatRadius', 0.0002, 0.01, 0.0001).name('かき混ぜる幅');
    sim.add(this, 'splatForce', 1000, 30000, 500).name('かき混ぜる強さ');
    sim.add(this, 'normalEpsilon', 0.005, 0.5, 0.005).name('屈折の強さ');

    const look = folder.addFolder('見た目');
    look.add(this, 'emission', 0, 20, 0.1).name('発光');
    look.add(this, 'emissionWhiteness', 0, 1, 0.01).name('発光の白さ');
    look.addColor(this, 'color').name('発光色');
    look.add(this, 'opacity', 0, 1, 0.01).name('不透明度');
    return folder;
  }

  dispose(): void {
    this.fluid?.dispose();
    this.fluid = null;
    this.renderer = null;
    this.pass = null;
  }
}
