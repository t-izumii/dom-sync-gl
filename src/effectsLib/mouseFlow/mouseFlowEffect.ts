import * as THREE from 'three/webgpu';
import {
  clamp,
  distance,
  float,
  length,
  select,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec4,
} from 'three/tsl';
import type { Node, TextureNode, UniformNode } from 'three/webgpu';
import type GUI from 'lil-gui';
import { BaseEffect, type BaseEffectConfig } from '../../index';

export interface MouseFlowEffectOptions {
  /** ピンポンバッファの一辺の解像度（px）。大きいほど精細だが GPU 負荷増。 */
  size?: number;
  /** シーンを歪ませる強さ。 */
  strength?: number;
  /** フローの減衰（1 に近いほど軌跡が長く残る）。 */
  dissipation?: number;
  /** マウスからの影響半径（UV 距離）。 */
  falloff?: number;
}

/**
 * マウスフロー（流体的なゆがみ）ポストエフェクト。
 *
 * 内部に size x size のピンポンバッファを持ち、毎フレーム displacement ノードで
 * マウス移動量を蓄積・減衰させ、その結果（tFlow）を outputNode に渡してシーン全体の
 * UV をゆがませる。マウスの軌跡に沿って画面が流れるように歪む。
 *
 * FeedbackBuffer は使わない: フローは符号つき値を 0.5 中心にパックして保持するため
 * FloatType の RT が必須だが、FeedbackBuffer の RT は 8bit 固定で量子化の消え残り
 * （残留歪み）が出る。NearestFilter やニュートラル初期化も指定できないため、
 * 同じ QuadMesh + MeshBasicNodeMaterial(colorNode) パターンで自前管理する。
 */
export class MouseFlowEffect extends BaseEffect {
  public strength: number;
  public dissipation: number;
  public falloff: number;

  /** ピンポンバッファの一辺の解像度。 */
  public size: number;

  private renderer: THREE.WebGPURenderer | null = null;
  private read: THREE.RenderTarget | null;
  private write: THREE.RenderTarget | null;

  private simMaterial: THREE.MeshBasicNodeMaterial | null;
  // fullscreen 描画は QuadMesh に任せる（clip 空間 z の WebGL/WebGPU 差の吸収。
  // Why の詳細は EffectComposer の quad 宣言部を参照）。
  private quad: THREE.QuadMesh | null;

  // renderer.init() 完了前に GPU コマンドを発行できないため、RT の初期クリアは
  // コンストラクタではなく初回 update()（render ループ内 = init 完了後）まで遅延する。
  private cleared = false;

  /*
   * TSL ノード。構築時に一度だけノードグラフへ組み込まれ、以後は
   * `.value` の差し替えのみで毎フレーム更新される。
   */
  private readonly tMap: TextureNode;
  private readonly uMouse: UniformNode<THREE.Vector2>;
  private readonly uDeltaMouse: UniformNode<THREE.Vector2>;
  private readonly uDissipation: UniformNode<number>;
  private readonly uFalloff: UniformNode<number>;
  private readonly tFlow: TextureNode;
  private readonly uStrength: UniformNode<number>;

  private readonly _prevMouse = new THREE.Vector2(0.5, 0.5);
  private readonly _delta = new THREE.Vector2();
  private _hasPrevMouse = false;
  // 1 フレームの移動量がこれ（UV 距離）を超えたらテレポートとみなし無視する。
  private readonly _maxDelta = 0.1;

  constructor(options: MouseFlowEffectOptions = {}) {
    super();
    this.size = Math.max(16, Math.floor(options.size ?? 64));
    this.strength = options.strength ?? 2.5;
    this.dissipation = options.dissipation ?? 0.8;
    this.falloff = options.falloff ?? 0.2;

    this.read = this.makeTarget();
    this.write = this.makeTarget();

    this.tMap = texture(this.read.texture);
    this.tFlow = texture(this.read.texture);
    this.uMouse = uniform(new THREE.Vector2(0.5, 0.5));
    this.uDeltaMouse = uniform(new THREE.Vector2());
    this.uDissipation = uniform(this.dissipation);
    this.uFalloff = uniform(this.falloff);
    this.uStrength = uniform(this.strength);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = this.buildSimNode();
    material.depthTest = false;
    material.depthWrite = false;
    // ピンポン先を丸ごと置き換えるパスなので blend しない（FeedbackBuffer と同方針）。
    material.blending = THREE.NoBlending;
    this.simMaterial = material;
    this.quad = new THREE.QuadMesh(material);
  }

  /** Float の ping-pong RT を作る。 */
  private makeTarget(): THREE.RenderTarget {
    return new THREE.RenderTarget(this.size, this.size, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      stencilBuffer: false,
      depthBuffer: false,
      colorSpace: THREE.NoColorSpace,
    });
  }

  /**
   * シミュレーションパス（旧 displacement.glsl の忠実移植）。
   * rg にフロー（移動量）を 0.5 中心のニュートラル値としてパックして書き戻す。
   *
   * 旧実装は RT を CPU 側で 0.5 クリアしてニュートラル化していたが、クリア色は
   * アクティブな描画先のカラースペースで解釈されるためバックエンド依存の罠がある
   * （旧コードの clearNeutral 参照）。ここでは a をイニシャライズ済みフラグにして
   * シェーダー側で吸収する: クリア値 (0,0,0,0) は a=0 なのでフロー 0（ニュートラル）
   * として読み、書き込みは常に a=1 で行う。
   */
  private buildSimNode(): Node {
    const prev = this.tMap;
    const prevFlow = prev.rg.mul(2.0).sub(1.0).mul(prev.a);

    // マウス移動がある場合のみ注入
    const deltaLength = length(this.uDeltaMouse).mul(0.5);
    const dist = float(1.0).sub(
      smoothstep(0.0, this.uFalloff, distance(uv(), this.uMouse)),
    );
    const injected = select(
      deltaLength.greaterThan(0.0001),
      this.uDeltaMouse.mul(dist),
      vec2(0.0),
    );

    const flow = prevFlow.add(injected).mul(this.uDissipation);
    return vec4(flow.mul(0.5).add(0.5), 0.0, 1.0);
  }

  /**
   * 描画パス（旧 flow.glsl の忠実移植）。
   * フローマップ（tFlow）の移動量ぶんだけ前段出力の UV をずらしてシーンを歪ませる。
   */
  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: ({ inputTexture, uv }) => {
        const flow = this.tFlow.rg.mul(2.0).sub(1.0);
        const shifted = uv.sub(flow.mul(this.uStrength));
        return inputTexture.sample(clamp(shifted, 0.0, 1.0));
      },
      uniforms: {
        tFlow: this.tFlow,
        uStrength: this.uStrength,
      },
    };
  }

  _setRenderer(renderer: THREE.WebGPURenderer): void {
    this.renderer = renderer;
  }

  private clearTargets(): void {
    const r = this.renderer;
    if (!r || !this.read || !this.write) return;
    const prevTarget = r.getRenderTarget();
    // WebGPURenderer の getClearColor は Color4 を要求するが、three/webgpu は
    // Color4 をランタイム export していないため Color を流用する（copy で rgb が
    // 写り、alpha は getClearAlpha() で別途保存・復元する）。
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

  update(_time: number, mouse?: THREE.Vector2): void {
    const renderer = this.renderer;
    const quad = this.quad;
    if (!this.pass || !renderer || !quad || !this.read || !this.write) return;

    if (!this.cleared) {
      this.clearTargets();
      this.cleared = true;
    }

    // マウス移動量（前フレーム差分）を算出
    const m = mouse ?? this._prevMouse;
    if (this._hasPrevMouse) {
      this._delta.copy(m).sub(this._prevMouse);
      // ポインタが初期値 (0.5,0.5) から実カーソル位置へワープした初動や、
      // 画面外からの再侵入では、1 フレームでは起こり得ない巨大な delta が出る。
      // これを注入すると uStrength で増幅されロード時に一瞬フラッシュするため、
      // テレポートとみなして移動量を無視する（座標の追従だけ行う）。
      if (this._delta.lengthSq() > this._maxDelta * this._maxDelta) {
        this._delta.set(0, 0);
      }
    } else {
      this._delta.set(0, 0);
    }
    this._prevMouse.copy(m);
    this._hasPrevMouse = true;

    this.uMouse.value.copy(m);
    this.uDeltaMouse.value.copy(this._delta);
    this.uDissipation.value = this.dissipation;
    this.uFalloff.value = this.falloff;
    this.tMap.value = this.read.texture;

    // displacement を write ターゲットに描画（外部の描画先は保存・復元する）
    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(this.write);
    quad.render(renderer);
    renderer.setRenderTarget(prevRT);

    // read/write を入れ替え、最新フローを flow パスへ渡す
    const tmp = this.read;
    this.read = this.write;
    this.write = tmp;

    this.setUniform('tFlow', this.read.texture);
    this.setUniform('uStrength', this.strength);
  }

  setupGUI(gui: GUI): GUI {
    const folder = gui.addFolder('マウスフロー (Mouse flow)');
    folder.add(this, 'enabled').name('有効');
    folder.add(this, 'strength', 0.0, 10.0, 0.1).name('歪みの強さ');
    folder.add(this, 'dissipation', 0.8, 1.0, 0.001).name('減衰（消える速さ）');
    folder.add(this, 'falloff', 0.01, 1.0, 0.01).name('影響半径');
    return folder;
  }

  dispose(): void {
    this.read?.dispose();
    this.write?.dispose();
    // QuadMesh の geometry は全インスタンス共有のため dispose してはいけない。
    // 解放対象は sim パスの material のみ。
    this.simMaterial?.dispose();
    this.read = null;
    this.write = null;
    this.simMaterial = null;
    this.quad = null;
    this.renderer = null;
    this.pass = null;
  }
}
