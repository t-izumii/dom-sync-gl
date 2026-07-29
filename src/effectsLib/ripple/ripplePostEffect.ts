/**
 * マウス追従の波紋ポストエフェクト（TSL）。HalfFloat の自前 ping-pong で波動方程式を
 * 解き、勾配で inputTexture を屈折＋鏡面する。sim は R=h^n / G=h^{n-1} を生格納する
 * ため FeedbackBuffer（8bit RT・固定正方サイズ）は使わず、RenderTarget +
 * MeshBasicNodeMaterial(colorNode) + QuadMesh で自前管理する。
 * feedback 版は {@link rippleTexture}。
 */
import * as THREE from 'three/webgpu';
import {
  clamp,
  dot,
  exp,
  float,
  max,
  mix,
  normalize,
  pow,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { Node, TextureNode, UniformNode } from 'three/webgpu';
import type GUI from 'lil-gui';
import { BaseEffect, type BaseEffectConfig } from '../../index';

export interface RipplePostEffectOptions {
  /** シミュレーショングリッドの横セル数。縦は画面アスペクトから決まる。大きいほど精細だが GPU 負荷増。 */
  resolution?: number;
  /** 波源を生成し始めるマウス移動量のしきい値（UV 距離）。 */
  moveThreshold?: number;

  // --- シミュレーション ---
  /** 波速²（leapfrog の安定条件より 0〜0.5）。 */
  speed?: number;
  /** 毎ステップの減衰（1 に近いほど長く残る）。 */
  damping?: number;
  /** 波源の半径（セル数）。 */
  splatRadius?: number;
  /** 波源の強さ。 */
  splatStrength?: number;

  // --- 描画 ---
  distortion?: number;
  normalScale?: number;
  specularPower?: number;
  specularIntensity?: number;
  lightDir?: THREE.Vector3;
}

// texture() ノードは有効な Texture を要求するため、RT 構築前の初期値に使う
// 1x1 透明テクスチャ（モジュール内共有）。
const placeholderTexture = new THREE.DataTexture(
  new Uint8Array([0, 0, 0, 0]),
  1,
  1,
);
placeholderTexture.needsUpdate = true;

/**
 * マウス追従の波紋ポストエフェクト（HalfFloat ping-pong で波動方程式を解き、勾配で
 * inputTexture を屈折＋鏡面）。feedback 版は {@link rippleTexture}。
 */
export class RipplePostEffect extends BaseEffect {
  // シミュレーション
  public speed: number;
  public damping: number;
  public splatRadius: number;
  public splatStrength: number;

  // 描画
  public distortion: number;
  public normalScale: number;
  public specularPower: number;
  public specularIntensity: number;
  private readonly lightDir: THREE.Vector3;

  /** シミュレーショングリッドの横セル数。GUI で変更すると再構築される。 */
  public resolution: number;
  private readonly moveThreshold: number;

  // GPU ping-pong リソース
  private renderer: THREE.WebGPURenderer | null = null;
  private read: THREE.RenderTarget | null = null;
  private write: THREE.RenderTarget | null = null;
  private readonly simMaterial: THREE.MeshBasicNodeMaterial;
  // fullscreen 描画は QuadMesh に任せる（clip 空間 z の WebGL/WebGPU 差の吸収。
  // Why の詳細は EffectComposer の quad 宣言部を参照）。
  private readonly quad: THREE.QuadMesh;
  // renderer.init() 完了前に GPU コマンドを発行できないため、RT の初期クリアは
  // buildTargets() ではなく次の update()（render ループ内 = init 完了後）まで遅延する。
  private cleared = false;

  // sim / post のノード。構築後はグラフを組み替えず `.value` 差し替えのみで更新する。
  private readonly simNodes: {
    uPrev: TextureNode;
    uGridSize: UniformNode<THREE.Vector2>;
    uSplatPos: UniformNode<THREE.Vector2>;
    uSplatAmount: UniformNode<number>;
    uSplatRadius: UniformNode<number>;
    uSpeed: UniformNode<number>;
    uDamping: UniformNode<number>;
  };
  private readonly postNodes: {
    uRippleTex: TextureNode;
    uTexelSize: UniformNode<THREE.Vector2>;
    uDistortion: UniformNode<number>;
    uNormalScale: UniformNode<number>;
    uLightDir: UniformNode<THREE.Vector3>;
    uSpecularPower: UniformNode<number>;
    uSpecularIntensity: UniformNode<number>;
  };

  private _gridW = 1;
  private _gridH = 1;
  private _aspect = 1;
  private readonly _prevMouse = new THREE.Vector2(0.5, 0.5);
  private _hasPrevMouse = false;

  constructor(options: RipplePostEffectOptions = {}) {
    super();
    this.resolution = Math.max(16, Math.floor(options.resolution ?? 320));
    this.moveThreshold = options.moveThreshold ?? 0.0005;

    this.speed = options.speed ?? 0.45;
    this.damping = options.damping ?? 0.996;
    this.splatRadius = options.splatRadius ?? 3;
    this.splatStrength = options.splatStrength ?? 0.6;

    this.distortion = options.distortion ?? 0.3;
    this.normalScale = options.normalScale ?? 6.0;
    this.specularPower = options.specularPower ?? 60.0;
    this.specularIntensity = options.specularIntensity ?? 1.0;
    this.lightDir = options.lightDir ?? new THREE.Vector3(-3.0, 10.0, 3.0);

    this.simNodes = {
      uPrev: texture(placeholderTexture),
      uGridSize: uniform(new THREE.Vector2(1, 1)),
      uSplatPos: uniform(new THREE.Vector2(0.5, 0.5)),
      uSplatAmount: uniform(0),
      uSplatRadius: uniform(this.splatRadius),
      uSpeed: uniform(this.speed),
      uDamping: uniform(this.damping),
    };
    this.postNodes = {
      uRippleTex: texture(placeholderTexture),
      uTexelSize: uniform(new THREE.Vector2(1, 1)),
      uDistortion: uniform(this.distortion),
      uNormalScale: uniform(this.normalScale),
      // 旧実装同様、caller の Vector3 参照を保持する（外から mutate すると追従する）
      uLightDir: uniform(this.lightDir),
      uSpecularPower: uniform(this.specularPower),
      uSpecularIntensity: uniform(this.specularIntensity),
    };

    this.simMaterial = new THREE.MeshBasicNodeMaterial();
    this.simMaterial.colorNode = this.buildSimNode();
    this.simMaterial.depthTest = false;
    this.simMaterial.depthWrite = false;
    // sim は前フレームの丸ごと置き換え。blend が掛かると HalfFloat の生値が壊れる。
    this.simMaterial.blending = THREE.NoBlending;
    this.quad = new THREE.QuadMesh(this.simMaterial);
  }

  /** 旧 ripplePostSim.frag.glsl の TSL 版（R=h^n / G=h^{n-1} の leapfrog 1 ステップ）。 */
  private buildSimNode(): Node {
    const { uPrev, uGridSize, uSplatPos, uSplatAmount, uSplatRadius, uSpeed, uDamping } =
      this.simNodes;
    const uvN = uv();
    const texel = vec2(1.0, 1.0).div(uGridSize);

    const p = uPrev.sample(uvN);
    const h = p.r;
    const hPrev = p.g;

    const hL = uPrev.sample(uvN.sub(vec2(texel.x, 0.0))).r;
    const hR = uPrev.sample(uvN.add(vec2(texel.x, 0.0))).r;
    const hD = uPrev.sample(uvN.sub(vec2(0.0, texel.y))).r;
    const hU = uPrev.sample(uvN.add(vec2(0.0, texel.y))).r;
    const lap = hL.add(hR).add(hD).add(hU).sub(h.mul(4.0));

    let hNext: Node = h.mul(2.0).sub(hPrev).add(uSpeed.mul(lap)).mul(uDamping);

    // 動いたフレームだけ波源（セル空間ガウシアン＝画面上で円形）
    const df = uvN.sub(uSplatPos).mul(uGridSize);
    const r2 = max(uSplatRadius.mul(uSplatRadius), 1e-4);
    hNext = hNext.add(uSplatAmount.mul(exp(dot(df, df).div(r2).mul(-1.0))));

    // 端を吸収して反射を抑える境界
    const m = 0.04;
    const edge = smoothstep(0.0, m, uvN.x)
      .mul(smoothstep(0.0, m, float(1.0).sub(uvN.x)))
      .mul(smoothstep(0.0, m, uvN.y))
      .mul(smoothstep(0.0, m, float(1.0).sub(uvN.y)));
    hNext = hNext.mul(mix(0.9, 1.0, edge));

    return vec4(hNext, h, 0.0, 1.0);
  }

  /** HalfFloat の ping-pong RT を作る。 */
  private makeTarget(w: number, h: number): THREE.RenderTarget {
    return new THREE.RenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  /** 画面アスペクトに合わせてグリッド（RT 2 枚）を作り直す。クリアは次の update() まで遅延。 */
  private buildTargets(aspect: number): void {
    if (!this.renderer) return;

    this._gridW = Math.max(16, Math.round(this.resolution));
    this._gridH = Math.max(16, Math.round(this.resolution / aspect));

    this.read?.dispose();
    this.write?.dispose();
    this.read = this.makeTarget(this._gridW, this._gridH);
    this.write = this.makeTarget(this._gridW, this._gridH);
    // first frame のゴミ防止の 0 クリアは init 完了後（update 内）に行う
    this.cleared = false;

    this.simNodes.uGridSize.value.set(this._gridW, this._gridH);
    this.simNodes.uPrev.value = this.read.texture;
    this.postNodes.uRippleTex.value = this.read.texture;
    this.postNodes.uTexelSize.value.set(1 / this._gridW, 1 / this._gridH);
  }

  /** ping-pong RT を (0,0,0,0) でクリアする（renderer の状態は復元）。 */
  private clearTargets(): void {
    const r = this.renderer;
    if (!r || !this.read || !this.write) return;
    const prevTarget = r.getRenderTarget();
    // Color4 型の扱いは FeedbackBuffer.clearTargets() と同じ理由で Color を流用する。
    const prevColor = r.getClearColor(
      new THREE.Color() as unknown as Parameters<
        THREE.WebGPURenderer['getClearColor']
      >[0],
    );
    const prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.read);
    r.clear();
    r.setRenderTarget(this.write);
    r.clear();
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevColor, prevAlpha);
  }

  _setRenderer(renderer: THREE.WebGPURenderer): void {
    this.renderer = renderer;
    const sz = renderer.getSize(new THREE.Vector2());
    this._aspect = sz.x / sz.y || 1;
    this.buildTargets(this._aspect);
  }

  protected getConfig(): BaseEffectConfig {
    const n = this.postNodes;
    return {
      // 旧 ripplePost.frag.glsl の TSL 版（高さ場の近傍差分 → 屈折＋鏡面）
      outputNode: (ctx) => {
        const uvN = ctx.uv;
        const hL = n.uRippleTex.sample(uvN.sub(vec2(n.uTexelSize.x, 0.0))).r;
        const hR = n.uRippleTex.sample(uvN.add(vec2(n.uTexelSize.x, 0.0))).r;
        const hD = n.uRippleTex.sample(uvN.sub(vec2(0.0, n.uTexelSize.y))).r;
        const hU = n.uRippleTex.sample(uvN.add(vec2(0.0, n.uTexelSize.y))).r;
        const grad = vec2(hR.sub(hL), hU.sub(hD));

        const color = ctx.inputTexture.sample(
          clamp(uvN.add(grad.mul(n.uDistortion)), 0.0, 1.0),
        );

        const normal = normalize(
          vec3(
            grad.x.mul(-1.0).mul(n.uNormalScale),
            1.0,
            grad.y.mul(-1.0).mul(n.uNormalScale),
          ),
        );
        const specular = pow(
          max(dot(normal, normalize(n.uLightDir)), 0.0),
          n.uSpecularPower,
        ).mul(n.uSpecularIntensity);

        return vec4(color.rgb.add(specular), color.a);
      },
      uniforms: {
        uTexelSize: n.uTexelSize,
        uDistortion: n.uDistortion,
        uNormalScale: n.uNormalScale,
        uLightDir: n.uLightDir,
        uSpecularPower: n.uSpecularPower,
        uSpecularIntensity: n.uSpecularIntensity,
      },
    };
  }

  update(_time: number, mouse?: THREE.Vector2): void {
    const renderer = this.renderer;
    if (!this.pass || !renderer || !this.read || !this.write) return;

    if (!this.cleared) {
      this.clearTargets();
      this.cleared = true;
    }

    const sn = this.simNodes;

    // マウスが動いたフレームだけ波源を落とす
    const m = mouse ?? this._prevMouse;
    const moved =
      this._hasPrevMouse && m.distanceTo(this._prevMouse) > this.moveThreshold;
    sn.uSplatPos.value.copy(m);
    sn.uSplatAmount.value = moved ? this.splatStrength : 0.0;
    this._prevMouse.copy(m);
    this._hasPrevMouse = true;

    sn.uPrev.value = this.read.texture;
    sn.uSplatRadius.value = this.splatRadius;
    sn.uSpeed.value = this.speed;
    sn.uDamping.value = this.damping;

    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(this.write);
    this.quad.render(renderer);
    renderer.setRenderTarget(prevRT);

    const tmp = this.read;
    this.read = this.write;
    this.write = tmp;

    const pn = this.postNodes;
    pn.uRippleTex.value = this.read.texture;
    pn.uDistortion.value = this.distortion;
    pn.uNormalScale.value = this.normalScale;
    pn.uSpecularPower.value = this.specularPower;
    pn.uSpecularIntensity.value = this.specularIntensity;
  }

  setupGUI(gui: GUI): GUI {
    const folder = gui.addFolder('波紋 (Ripple / post)');
    folder.add(this, 'enabled').name('有効');

    const sim = folder.addFolder('シミュレーション');
    // 解像度はスライダーではなく離散セレクター（splashCursor の sim/dye 解像度と同じ流儀）。
    // 値を変えるたびに RT を作り直すため、連続値でドラッグ中に無数の中間解像度を
    // 試させる意味がなく、段階を絞ったほうが負荷の比較もしやすい。
    sim
      .add(this, 'resolution', [64, 128, 256, 320, 512])
      .name('解像度')
      .onFinishChange(() => this.buildTargets(this._aspect));
    sim.add(this, 'speed', 0.05, 0.5, 0.005).name('波速');
    sim.add(this, 'damping', 0.9, 1.0, 0.0005).name('減衰（消える速さ）');
    sim.add(this, 'splatStrength', 0.0, 3.0, 0.01).name('波源の強さ');
    sim.add(this, 'splatRadius', 1, 10, 1).name('波源の半径');

    const render = folder.addFolder('描画');
    render.add(this, 'distortion', 0.0, 1.0, 0.01).name('歪み');
    render.add(this, 'normalScale', 0.0, 30.0, 0.1).name('法線の傾き');
    render.add(this, 'specularPower', 1.0, 200.0, 1.0).name('鏡面の鋭さ');
    render.add(this, 'specularIntensity', 0.0, 5.0, 0.01).name('鏡面の強さ');

    return folder;
  }

  resize(width: number, height: number): void {
    this._aspect = width / height || 1;
    // uTexelSize は buildTargets() が更新する
    this.buildTargets(this._aspect);
  }

  dispose(): void {
    this.read?.dispose();
    this.write?.dispose();
    // QuadMesh の geometry は全インスタンス共有のため dispose してはいけない。
    this.simMaterial.dispose();
    this.read = null;
    this.write = null;
    this.renderer = null;
    this.pass = null;
  }
}
