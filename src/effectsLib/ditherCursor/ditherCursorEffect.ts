import * as THREE from 'three/webgpu';
import { texture, uniform } from 'three/tsl';
import type { TextureNode, UniformNode } from 'three/webgpu';
import type GUI from 'lil-gui';
import { BaseEffect, type BaseEffectConfig } from '../../index';
import { ditherDisplayNode, ditherSimNode } from './ditherCursorNodes';

export interface DitherCursorEffectOptions {
  /** ディザドット 1 個のサイズ（px）。大きいほど粗い。 */
  ditherSize?: number;
  /** ブラシ半径（UV。アスペクト補正済み距離に対して効く）。 */
  radius?: number;
  /** 濃度場に掛ける pow カーブ。大きいほど縁が締まる。 */
  exponent?: number;
  /** 毎フレームの線形減衰量。大きいほど残像が速く消える。 */
  decay?: number;
  /** ブラシの濃さ。 */
  intensity?: number;
  /** ドットの色。 */
  color?: string;
}

/**
 * ディザカーソル ポストエフェクト（React Bits Pro "Dither Cursor" の移植）。
 *
 * マウス軌跡を HalfFloat ping-pong RT 上の「インク濃度場」として蓄積し
 * （curl noise 移流 + 5 タップ拡散 + 速度ゲート付き Gaussian ブラシ + 線形減衰）、
 * 表示パスで Bayer 8x8 ordered dithering の閾値により 2 値化して合成する。
 */
export class DitherCursorEffect extends BaseEffect {
  /** ディザドット 1 個のサイズ（px）。 */
  public ditherSize: number;
  /** ブラシ半径（UV）。 */
  public radius: number;
  /** 濃度の pow カーブ。 */
  public exponent: number;
  /** 毎フレームの線形減衰量。 */
  public decay: number;
  /** ブラシの濃さ。 */
  public intensity: number;
  /** ドットの色（lil-gui addColor 対応）。 */
  public readonly color: THREE.Color;

  // GPU ping-pong リソース。RenderTarget の生成自体は GPU コマンドを発行しない
  // ため、constructor で 1x1 のダミーを作ってノードグラフに有効な texture を
  // 供給し、実サイズへの再構築は renderer 取得後の buildTargets() で行う。
  private renderer: THREE.WebGPURenderer | null = null;
  private read: THREE.RenderTarget | null = null;
  private write: THREE.RenderTarget | null = null;
  // fullscreen 描画は QuadMesh に任せる（clip 空間 z の WebGL/WebGPU 差の吸収。
  // Why の詳細は EffectComposer の quad 宣言部を参照）。
  private readonly simMaterial: THREE.MeshBasicNodeMaterial;
  private readonly quad: THREE.QuadMesh;

  // renderer.init() 完了前に GPU コマンドを発行できないため、sim パスの実行と
  // RT の初期クリアは init 完了後まで遅延する（FeedbackBuffer と同じ方針）。
  private _rendererReady = false;
  private _cleared = false;

  // TSL ノード（構築時に一度だけグラフへ組み込まれ、以後は .value 差し替えのみ）
  private readonly uPrev: TextureNode;
  private readonly tSimulation: TextureNode;
  private readonly uResolution = uniform(new THREE.Vector2(1, 1));
  private readonly uTime = uniform(0);
  private readonly uMouse = uniform(new THREE.Vector2(0.5, 0.5));
  private readonly uSpeed = uniform(0);
  private readonly uRadius: UniformNode<number>;
  private readonly uDecay: UniformNode<number>;
  private readonly uIntensity: UniformNode<number>;
  private readonly uDitherSize: UniformNode<number>;
  private readonly uExponent: UniformNode<number>;
  private readonly uColor: UniformNode<THREE.Color>;

  private readonly _prevMouse = new THREE.Vector2(0.5, 0.5);
  private _hasPrevMouse = false;
  /** lerp 平滑化したマウス速度（UV 距離/フレーム）。速度ゲートに渡す。 */
  private _speed = 0;
  // 1 フレームの移動量がこれ（UV 距離）を超えたらテレポートとみなし、
  // 速度としてカウントしない（画面外からの再侵入で急激なインク注入を防ぐ）。
  private readonly _maxDelta = 0.25;

  constructor(options: DitherCursorEffectOptions = {}) {
    super();
    // 本家 DitherCursor の props 既定値（色はデモの既定色）
    this.ditherSize = options.ditherSize ?? 4;
    this.radius = options.radius ?? 0.1;
    this.exponent = options.exponent ?? 2.0;
    this.decay = options.decay ?? 0.01;
    this.intensity = options.intensity ?? 0.5;
    // 色忠実性: this.color は API / lil-gui addColor 向けに生の hex 値のまま
    // 保持し（NoColorSpace で変換を回避）、uniform へは毎フレーム linear 化して
    // 流し込む。v0.4 の colorNode は最終パスで linear→sRGB 変換が掛かるため、
    // linear を渡すことで画面にはカラーピッカーの hex がそのまま出る
    // （= 旧版の「生 float を無変換で出力」と同じ見た目になる）。
    this.color = new THREE.Color().setStyle(
      options.color ?? '#FF9FFC',
      THREE.NoColorSpace,
    );

    this.uRadius = uniform(this.radius);
    this.uDecay = uniform(this.decay);
    this.uIntensity = uniform(this.intensity);
    this.uDitherSize = uniform(this.ditherSize);
    this.uExponent = uniform(this.exponent);
    this.uColor = uniform(this.color.clone().convertSRGBToLinear());

    // ノードグラフ構築時から有効な texture を参照できるよう 1x1 で先に作る
    this.read = this.makeTarget(1, 1);
    this.write = this.makeTarget(1, 1);
    this.uPrev = texture(this.read.texture);
    this.tSimulation = texture(this.read.texture);

    this.simMaterial = new THREE.MeshBasicNodeMaterial();
    this.simMaterial.colorNode = ditherSimNode({
      uPrev: this.uPrev,
      uResolution: this.uResolution,
      uTime: this.uTime,
      uMouse: this.uMouse,
      uSpeed: this.uSpeed,
      uRadius: this.uRadius,
      uDecay: this.uDecay,
      uIntensity: this.uIntensity,
    });
    this.simMaterial.depthTest = false;
    this.simMaterial.depthWrite = false;
    // sim は RT を丸ごと置き換えるため blend なしを明示する
    this.simMaterial.blending = THREE.NoBlending;
    this.quad = new THREE.QuadMesh(this.simMaterial);
  }

  /** HalfFloat の ping-pong RT を作る。シミュレーション値の滲み防止に Nearest。 */
  private makeTarget(w: number, h: number): THREE.RenderTarget {
    return new THREE.RenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  /**
   * drawing buffer と同解像度の RT 2 枚を作り直す。
   * クリアは GPU コマンドになるため、ここでは行わず次回 update()
   * （renderer.init() 完了後）まで遅延する（_cleared フラグをリセット）。
   */
  private buildTargets(): void {
    const renderer = this.renderer;
    if (!renderer) return;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, Math.round(size.x));
    const h = Math.max(1, Math.round(size.y));

    this.read?.dispose();
    this.write?.dispose();
    this.read = this.makeTarget(w, h);
    this.write = this.makeTarget(w, h);
    this._cleared = false;

    this.uResolution.value.set(w, h);
    this.uPrev.value = this.read.texture;
    this.tSimulation.value = this.read.texture;
  }

  /** first frame のゴミ防止に ping-pong RT を 0 クリアする（renderer の状態は復元）。 */
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

  _setRenderer(renderer: THREE.WebGPURenderer): void {
    this.renderer = renderer;
    // init() は冪等（解決済みでも同じ Promise を返す）ため多重呼び出しは安全。
    // 失敗時は Core 側が app.ready 経由でエラーを表面化するため、ここでは
    // effect を恒久 no-op に留める（未処理 rejection を出さない）。
    renderer
      .init()
      .then(() => {
        this._rendererReady = true;
      })
      .catch(() => {});
    this.buildTargets();
  }

  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: (ctx) =>
        ditherDisplayNode(ctx, {
          tSimulation: this.tSimulation,
          uDitherSize: this.uDitherSize,
          uExponent: this.uExponent,
          uColor: this.uColor,
        }),
      uniforms: {
        uDitherSize: this.uDitherSize,
        uExponent: this.uExponent,
        uColor: this.uColor as UniformNode<unknown>,
      },
    };
  }

  update(time: number, mouse?: THREE.Vector2): void {
    // マウス速度（UV 距離/フレーム）を lerp 平滑化。止めた直後もふわっと減る。
    // テレポート級の移動は速度 0 扱い（急激なインク注入を防ぐ）。
    // GPU を触らない状態更新なので renderer 未準備でも先行して進める。
    const m = mouse ?? this._prevMouse;
    let delta = this._hasPrevMouse ? m.distanceTo(this._prevMouse) : 0;
    if (delta > this._maxDelta) delta = 0;
    this._speed += (delta - this._speed) * 0.1;
    this._prevMouse.copy(m);
    this._hasPrevMouse = true;

    const renderer = this.renderer;
    if (
      !this.pass ||
      !renderer ||
      !this._rendererReady ||
      !this.read ||
      !this.write
    ) {
      return;
    }

    if (!this._cleared) {
      this.clearTargets();
      this._cleared = true;
    }

    this.uPrev.value = this.read.texture;
    this.uTime.value = time;
    this.uMouse.value.copy(m);
    this.uSpeed.value = this._speed;
    this.uRadius.value = this.radius;
    this.uDecay.value = this.decay;
    this.uIntensity.value = this.intensity;

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.write);
    this.quad.render(renderer);
    renderer.setRenderTarget(prevTarget);

    const tmp = this.read;
    this.read = this.write;
    this.write = tmp;

    this.tSimulation.value = this.read.texture;
    this.setUniform('uDitherSize', this.ditherSize);
    this.setUniform('uExponent', this.exponent);
    // this.color は生 hex（NoColorSpace）のまま公開しているため、
    // uniform へは linear 化した値を毎フレーム反映する（GUI 編集にも追従）。
    this.uColor.value.copy(this.color).convertSRGBToLinear();
  }

  resize(): void {
    this.buildTargets();
  }

  setupGUI(gui: GUI): GUI {
    const folder = gui.addFolder('ディザカーソル (Dither cursor)');
    folder.add(this, 'enabled').name('有効');
    folder.add(this, 'ditherSize', 1, 16, 1).name('ドットサイズ (px)');
    folder.add(this, 'radius', 0.02, 0.4, 0.005).name('半径');
    folder.add(this, 'exponent', 0.5, 8, 0.1).name('減衰カーブ (exponent)');
    folder.add(this, 'decay', 0.001, 0.05, 0.001).name('減衰速度 (decay)');
    folder.add(this, 'intensity', 0.05, 1, 0.01).name('ブラシの濃さ');
    folder.addColor(this, 'color').name('色');
    return folder;
  }

  dispose(): void {
    this.read?.dispose();
    this.write?.dispose();
    // QuadMesh の geometry は全インスタンス共有のため dispose してはいけない。
    // 解放対象は sim material のみ。
    this.simMaterial.dispose();
    this.read = null;
    this.write = null;
    this.renderer = null;
    this.pass = null;
  }
}
