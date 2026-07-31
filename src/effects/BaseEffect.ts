import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  MeshBasicNodeMaterial,
  NoBlending,
  QuadMesh,
  RenderTarget,
  RGBAFormat,
  Vector2,
} from "three/webgpu";
import { texture, uniform, uv } from "three/tsl";
import type {
  MagnificationTextureFilter,
  Node,
  TextureDataType,
  TextureNode,
  UniformNode,
  WebGPURenderer,
} from "three/webgpu";
import type GUI from "lil-gui";
import type { EffectContext, EffectTarget, EffectPass } from "../EffectComposer";
import { MouseMotion } from "../MouseMotion";

/** feedback.node ファクトリに渡されるコンテキスト。 */
export interface FeedbackNodeContext {
  /** 前フレームの蓄積バッファを読む texture ノード */
  prev: TextureNode;
  /** 蓄積バッファの UV。左上原点（`EffectContext.uv` と同じ座標系） */
  uv: Node;
}

export interface FeedbackOptions {
  /** 新しい蓄積値（vec4）を返すファクトリ。register 時に一度だけ呼ばれる */
  node: (ctx: FeedbackNodeContext) => Node;
  /** 'screen' = drawing buffer と同解像度 / 数値 N = N×N の正方。既定 'screen' */
  size?: "screen" | number;
  /**
   * 既定 HalfFloat。8bit だと「前フレーム × 減衰率」の丸め戻りで小さな値が
   * 消えず、残像が永久に残るため。
   */
  type?: TextureDataType;
  filter?: MagnificationTextureFilter;
}

export interface BaseEffectConfig {
  /** vec4 の色ノードを返すファクトリ。register 時に一度だけ呼ばれる */
  outputNode: (ctx: EffectContext) => Node;
  /** uniform() で生成したノードの名前つきマップ。setUniform/getUniform で参照される */
  uniforms?: Record<string, UniformNode<unknown>>;
  /** 宣言すると effect 所有の蓄積バッファ（ping-pong RT ペア）が用意される */
  feedback?: FeedbackOptions;
}

/**
 * feedback 未宣言の effect の feedbackTexture が指す 1x1 透明テクスチャ。
 * ノードグラフは構築時に一度きりなので、texture ノードは常に有効な
 * Texture を指している必要がある。
 */
const placeholderTexture = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
placeholderTexture.needsUpdate = true;

/** drawing buffer サイズの取得先。毎リサイズの alloc を避けるための共有バッファ。 */
const _sizeScratch = new Vector2();

/**
 * ポストエフェクトの基底クラス。
 *
 * effect インスタンスは単一 owner・使い捨てで、`new → registered → disposed` の
 * 一方向ライフサイクルを取る。別 owner への再登録・dispose 後の再登録は throw
 * するため、使い回す場合は新しいインスタンスを生成する。
 */
export abstract class BaseEffect {
  protected pass: EffectPass | null = null;
  private _guiFolder: GUI | null = null;
  private _disposed = false;

  /**
   * 直近の描画サイズ（CSS px）。owner が screen なら canvas、plane なら plane のサイズ。
   *
   * シェーダー側の解像度は uniform 化していない。three/tsl の `screenSize` が
   * 毎レンダー自動更新・初期ダミー値なしで同等以上を提供するため。ここに持つのは
   * RenderTarget のサイズ指定など TSL では代替できない JS 側の実数のみ。
   */
  protected width = 1;
  protected height = 1;

  /** 経過秒。 */
  protected readonly uTime = uniform(0);

  /**
   * マウス UV。左上原点（`EffectContext.uv` と同じ座標系で、owner 側が Y を反転して渡す）。
   */
  protected readonly uMouse = uniform(new Vector2(0.5, 0.5));

  /**
   * 前フレームのマウス UV。座標系は `uMouse` と同じ（左上原点）。
   * 初回は `uMouse` と同値なので、差分を取る側は前回値の有無を気にしなくてよい。
   */
  protected readonly uPrevMouse = uniform(new Vector2(0.5, 0.5));

  /**
   * 蓄積バッファの最新結果を読む texture ノード。outputNode から参照する。
   * feedback を宣言していない effect では 1x1 の透明テクスチャを指す。
   */
  protected readonly feedbackTexture: TextureNode = texture(placeholderTexture);

  /** マウス移動強度（0〜1）。静止で 0 へ緩やかに減衰する。 */
  protected readonly uMove = uniform(0);

  /**
   * `uMove` / `uPrevMouse` の算出元。`threshold` / `scale` / `release` の
   * 調整ノブに加え、`prev`（前フレーム位置）を JS 側から読める。
   * サブクラスから書き換えてよい。
   *
   * `moveGate` ではなくこの名前なのは、ノブだけでなく状態も持つため。
   * `_prevMouse` / `_hasPrevMouse` / `moveThreshold` といった名前を避けているのは、
   * 同名の private を持つ既存サブクラスと衝突する（TS2415）ため。
   */
  protected readonly mouseMotion = new MouseMotion();

  /**
   * owner から注入される renderer。名前が `renderer` でないのは、サブクラスが
   * `private renderer` を持っている既存実装と衝突する（TS2415）ため。
   */
  protected glRenderer: WebGPURenderer | null = null;
  private _glRendererReady = false;

  private _feedback: FeedbackOptions | null = null;
  private _fbRead: RenderTarget | null = null;
  private _fbWrite: RenderTarget | null = null;
  private _fbPrev: TextureNode | null = null;
  private _fbMaterial: MeshBasicNodeMaterial | null = null;
  private _fbQuad: QuadMesh | null = null;
  private _fbCleared = false;
  private _fbWidth = 0;
  private _fbHeight = 0;

  private _enabled = true;
  get enabled(): boolean {
    return this._enabled;
  }
  set enabled(value: boolean) {
    this._enabled = value;
    if (this.pass) this.pass.enabled = value;
  }

  protected abstract getConfig(): BaseEffectConfig;

  _register(target: EffectTarget): void {
    // 二重 register を許すと update の二重実行や owner をまたいだ dispose が
    // 起きるため throw する。
    if (this._disposed) {
      throw new Error(
        "[BaseEffect] dispose 済みの effect は再登録できません。" +
          "使い回す場合は新しいインスタンスを作ってください。",
      );
    }
    if (this.pass !== null) {
      throw new Error(
        "[BaseEffect] この effect インスタンスは既に別の owner に登録済みです。" +
          "1 つの effect インスタンスは 1 つの owner にしか追加できません。" +
          "`webgl.addEffect()` と `domPlane.addEffect()` を併用する場合など、" +
          "使い回す場合は新しいインスタンスを作ってください。",
      );
    }
    // getConfig() は closure を返すだけで outputNode はまだ呼ばれていないため、
    // addEffect() より前に feedbackTexture を実 RT へ差し替えられる。
    const config = this.getConfig();
    if (config.feedback) this._setupFeedback(config.feedback);
    this.pass = target.addEffect({
      outputNode: config.outputNode,
      uniforms: config.uniforms,
    });
    this.pass.enabled = this._enabled;
  }

  _setRenderer?(_renderer: WebGPURenderer): void;

  /**
   * renderer の注入は `_setRenderer` とは別経路にしている。`_setRenderer` は
   * サブクラスがオーバーライドする公開フックで、`super` の呼び忘れで
   * 基底側の初期化が静かに飛ぶため。owner が必ず呼ぶ内部 API。
   */
  _attachRenderer(renderer: WebGPURenderer): void {
    this.glRenderer = renderer;
    // init() は冪等なので多重呼び出しは安全。失敗時は ready を立てないことで
    // GPU コマンドの発行を止める（no-op に留める）。
    try {
      void Promise.resolve(renderer.init()).then(
        () => {
          this._glRendererReady = true;
        },
        () => {},
      );
    } catch {
      // no-op
    }
  }

  /**
   * 共通の実行時状態の更新は owner 側から必ず呼ぶ内部 API にしている。
   * サブクラスの `resize()` / `update()` のオーバーライドに任せると
   * `super` の呼び忘れで静かに壊れるため。
   */
  _setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    if (this._feedback && (this._feedback.size ?? "screen") === "screen") {
      this._buildFeedbackTargets();
    }
  }

  private _setupFeedback(options: FeedbackOptions): void {
    this._feedback = options;

    const prev = texture(placeholderTexture);
    this._fbPrev = prev;

    const material = new MeshBasicNodeMaterial();
    // 蓄積 RT は前フレームの内容を丸ごと置き換えるため合成しない。
    material.colorNode = options.node({ prev, uv: uv() });
    material.depthTest = false;
    material.depthWrite = false;
    material.blending = NoBlending;
    this._fbMaterial = material;
    this._fbQuad = new QuadMesh(material);

    this._buildFeedbackTargets();
  }

  private _makeFeedbackTarget(w: number, h: number): RenderTarget {
    const fb = this._feedback;
    const filter = fb?.filter ?? LinearFilter;
    return new RenderTarget(w, h, {
      type: fb?.type ?? HalfFloatType,
      format: RGBAFormat,
      minFilter: filter,
      magFilter: filter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  /** サイズが実際に変わったときだけ作り直す（毎回作り直すと無駄な GPU 割り当てになる）。 */
  private _buildFeedbackTargets(): void {
    const fb = this._feedback;
    if (!fb || !this._fbPrev) return;

    let w: number;
    let h: number;
    if (typeof fb.size === "number") {
      w = h = Math.max(1, Math.round(fb.size));
    } else {
      // CSS px の this.width/height ではなく drawing buffer を使う（DPR 分ずれるため）。
      const renderer = this.glRenderer;
      if (!renderer) return;
      const size = renderer.getDrawingBufferSize(_sizeScratch);
      w = Math.max(1, Math.round(size.x));
      h = Math.max(1, Math.round(size.y));
    }

    if (this._fbRead && w === this._fbWidth && h === this._fbHeight) return;

    this._fbRead?.dispose();
    this._fbWrite?.dispose();
    this._fbRead = this._makeFeedbackTarget(w, h);
    this._fbWrite = this._makeFeedbackTarget(w, h);
    this._fbWidth = w;
    this._fbHeight = h;
    this._fbCleared = false;

    this._fbPrev.value = this._fbRead.texture;
    this.feedbackTexture.value = this._fbRead.texture;
  }

  private _clearFeedbackTargets(renderer: WebGPURenderer): void {
    if (!this._fbRead || !this._fbWrite) return;
    const prevTarget = renderer.getRenderTarget();
    // getClearColor は Color4 を要求するが three/webgpu は Color4 をランタイム
    // export していないため Color で代用し、alpha は別途保存・復元する。
    const prevColor = renderer.getClearColor(
      new Color() as unknown as Parameters<WebGPURenderer["getClearColor"]>[0],
    );
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this._fbRead);
    renderer.clear();
    renderer.setRenderTarget(this._fbWrite);
    renderer.clear();
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
  }

  /**
   * 蓄積バッファを 1 フレーム進める。owner は `update()` の**直後**に呼ぶ。
   * サブクラスが `update()` で GUI 由来の uniform を更新するため、先に描くと
   * 1 フレーム古い値で蓄積してしまう。
   */
  _renderFeedback(): void {
    const renderer = this.glRenderer;
    if (!this._feedback || !renderer || !this._glRendererReady) return;

    // register 時に renderer が居らず RT を作れなかった場合の遅延構築。
    if (!this._fbRead) this._buildFeedbackTargets();
    const read = this._fbRead;
    const write = this._fbWrite;
    const quad = this._fbQuad;
    const prev = this._fbPrev;
    if (!read || !write || !quad || !prev) return;

    if (!this._fbCleared) {
      this._clearFeedbackTargets(renderer);
      this._fbCleared = true;
    }

    prev.value = read.texture;

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(write);
    quad.render(renderer);
    renderer.setRenderTarget(prevTarget);

    this._fbRead = write;
    this._fbWrite = read;
    this.feedbackTexture.value = write.texture;
  }

  _setFrameState(time: number, mouse?: Vector2): void {
    this.uTime.value = time;
    if (mouse) this.uMouse.value.copy(mouse);
    this._updateMove(mouse);
  }

  /**
   * plane 側の `FeedbackContext.uMove` / `uPrevMouse`（`FeedbackBuffer.step()`）と
   * 同じ `MouseMotion` を使う。post effect 側にも同じ手触りを配って非対称を埋めている。
   */
  private _updateMove(mouse?: Vector2): void {
    if (mouse) {
      // サイズ 0（リサイズ途中など）で Infinity / NaN にならないようガードする。
      const aspect =
        this.width > 0 && this.height > 0 ? this.width / this.height : 1;
      this.mouseMotion.update(mouse, aspect);
      this.uPrevMouse.value.copy(this.mouseMotion.prev);
    } else {
      this.mouseMotion.decay();
    }
    this.uMove.value = this.mouseMotion.move;
  }

  update(_time: number, _mouse?: Vector2): void {}

  resize?(_width: number, _height: number): void;

  setupGUI?(gui: GUI): GUI | void;

  /**
   * setupGUI() が返したフォルダを登録する。呼び出し元は保持しない（`_dispose()` が破棄する）。
   * 既に _dispose() 済みなら（FeedbackBuffer._attachGUI() と同様）即座に破棄する。
   */
  _attachGUI(folder: GUI): void {
    if (this._disposed) {
      folder.destroy();
      return;
    }
    this._guiFolder = folder;
  }

  dispose?(): void;

  /**
   * `EffectManager` / `DomPlane` からの唯一の破棄経路。
   * setupGUI() で作られた GUI フォルダを破棄した上で、サブクラスの dispose() を呼ぶ。
   */
  _dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._guiFolder?.destroy();
    this._guiFolder = null;
    this._disposeFeedback();
    this.dispose?.();
  }

  private _disposeFeedback(): void {
    this._fbRead?.dispose();
    this._fbWrite?.dispose();
    // QuadMesh の geometry は全インスタンス共有のため dispose してはいけない。
    this._fbMaterial?.dispose();
    this._fbRead = null;
    this._fbWrite = null;
    this._fbMaterial = null;
    this._fbQuad = null;
    this._feedback = null;
    this.glRenderer = null;
  }

  setUniform(key: string, value: unknown): void {
    this.pass?.setUniform(key, value);
  }

  getUniform(key: string): UniformNode<unknown> | undefined {
    return this.pass?.getUniform(key);
  }

  getPass(): EffectPass | null {
    return this.pass;
  }
}
