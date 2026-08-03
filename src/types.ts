import type {
  ColorSpace,
  Node,
  TextureNode,
  UniformNode,
  Vector2,
} from "three/webgpu";
import type GUI from "lil-gui";
import type Stats from "stats.js";
import type { ScrollSyncOptions } from "./ScrollSync";

export interface Offset3D {
  x: number;
  y: number;
  z: number;
}

export interface DomSyncGLOptions {
  enablePointerTracking?: boolean;
  enableMouseTracking?: boolean;
  scrollSync?: boolean | ScrollSyncOptions;
  outputColorSpace?: ColorSpace;
  maxPixelRatio?: number;
  /**
   * 内部で requestAnimationFrame ループを回すか。
   * - true（既定）: ライブラリが自前で毎フレーム描画する（Lenis なしの単体利用向け）。
   * - false: 内部ループを止める。アプリ側の rAF から `app.tick(time)` を呼んで駆動する。
   *   Lenis 等のスムーズスクロールと 1 本の rAF で順序を保証したい場合に使う。
   */
  autoRaf?: boolean;
  /**
   * scrollSync の `attach: 'dom'` 時に、container が viewport の外にある間だけ
   * 描画ループを止めるか。既定 false（従来どおり常に回す）。
   * 復帰時は時間軸・スクロール速度・ポインタの前フレーム値を継ぎ直す。
   * `attach: 'translate'` と scrollSync 無しでは無視される（前者は container を
   * 毎 tick viewport へ貼り直す構造上オフスクリーンにならないため）。DEV では warn を出す。
   */
  pauseWhenOffscreen?: boolean;
  /**
   * pauseWhenOffscreen の判定に使う IntersectionObserver の rootMargin。
   * 既定 '100%'（DomPlane の inViewRootMargin と同値）。
   * IntersectionObserver の通知は rAF callback より後に配送されるため復帰は最短でも
   * 1 フレーム遅れる。0 まで詰めると復帰直後の 1 フレームが未描画で露出する。
   */
  pauseRootMargin?: string;
  /**
   * WebGPU が利用可能でも WebGL 2 バックエンドを強制する（デバッグ用）。
   * フォールバック時の見た目・挙動の検証に使う。既定: false（自動選択）。
   */
  forceWebGL?: boolean;
  /** 呼び出し元が生成した lil-gui インスタンス。渡された場合のみ setupGUI() 系のフックが有効になる（生成・破棄は呼び出し元の責務）。 */
  gui?: GUI | null;
  /** 呼び出し元が生成した stats.js インスタンス。渡された場合のみ毎フレーム begin()/end() を呼ぶ（DOM への挿入・破棄は呼び出し元の責務）。 */
  stats?: Stats | null;
  /**
   * EffectComposer の scene 描画 RenderTarget の MSAA サンプル数。既定 4、0 で無効化。
   * GPU 上限（取得できない場合は WebGPU 標準の 4）で clamp される。
   * effect 有効時に 3D geometry のエッジがジャギーになるのを防ぐ。
   */
  effectSamples?: number;
}

/**
 * createPlane の colorNode / positionNode ファクトリに渡されるコンテキスト。
 * ノードは plane 構築時に一度だけ作られ、以後は DomPlane が `.value` を毎フレーム
 * 更新する。ファクトリ内では TSL でノードグラフを組み立てて返す。
 */
export interface PlaneNodeContext {
  /** plane のテクスチャ（data-texture / setTexture / テキストラスタライズ結果） */
  uTexture: TextureNode;
  uAlpha: UniformNode<number>;
  /** plane の CSS ピクセルサイズ */
  uResolution: UniformNode<Vector2>;
  uTime: UniformNode<number>;
  /** hover 中 1 / 非 hover 0 */
  uIsHovered: UniformNode<number>;
  /** plane ローカルの マウス UV（左下原点） */
  uMouseUV: UniformNode<Vector2>;
  /**
   * 前フレームの `uMouseUV`。座標系は `uMouseUV` と同じ（左下原点）。
   * 初回は `uMouseUV` と同値なので、差分を取る側は前回値の有無を気にしなくてよい。
   */
  uPrevMouse: UniformNode<Vector2>;
  /** マウス移動強度（0〜1）。静止で緩やかに 0 へ落ちる */
  uMove: UniformNode<number>;
  /** options.uniforms で渡したユーザー uniform / texture ノード */
  uniforms: Record<string, UniformNode<unknown>>;
  uv: Node;
}

export interface CreatePlaneOptions {
  /**
   * plane の色を決める vec4 ノードを返すファクトリ。未指定ならテクスチャを
   * そのまま表示する。構築時に一度だけ呼ばれ、以後の毎フレーム更新は ctx の
   * ノードの `.value` 差し替えで行われる。
   */
  colorNode?: (ctx: PlaneNodeContext) => Node;
  /** 頂点変位用の position ノードを返すファクトリ。未指定なら既定の頂点処理 */
  positionNode?: (ctx: PlaneNodeContext) => Node;
  /**
   * 追加のカスタム uniform / texture ノード（TSL の uniform() / texture() で生成）。
   * colorNode / positionNode から ctx.uniforms 経由で参照できる。
   * 以下の予約名は DomPlane が内部で生成・毎フレーム更新するため渡せない
   * （渡すと throw する）:
   * `uTexture` / `uAlpha` / `uResolution` / `uTime` / `uIsHovered` / `uMouseUV` /
   * `uPrevMouse` / `uMove`。
   * addFeedback() を使う場合は outputUniform と同名の texture() ノードをここに
   * 渡しておく（FeedbackBuffer の出力がそのノードへ毎フレーム反映される）。
   */
  uniforms?: Record<string, UniformNode<unknown>>;
  updateRectEveryFrame?: boolean;
  segments?: number;
  onInView?: (plane: import('./DomPlane').DomPlane) => void;
  onOutView?: (plane: import('./DomPlane').DomPlane) => void;
  inViewRootMargin?: string;
  inViewRepeat?: boolean;
  crossOrigin?: string;
  /**
   * plane 用の GUI を組み立てるフック。`new DomSyncGL(..., { gui })` で gui を
   * 渡したときのみ呼ばれる。返したフォルダの破棄は plane の destroy() が行う。
   */
  setupGUI?: (gui: GUI, plane: import('./DomPlane').DomPlane) => GUI | void;
  /**
   * data-texture で読み込むテクスチャの色空間。
   * 既定は `SRGBColorSpace`: サンプル時に linear へデコードされ、画面出力時に
   * sRGB へ再エンコードされるため DOM の画像と表示が一致する（NodeMaterial は
   * 画面出力時の色空間変換を自動で行うため、旧版の「生の値を素通しする」前提の
   * `NoColorSpace` 既定から変更した）。生の値をそのまま扱いたい場合のみ
   * `NoColorSpace` を指定する。
   */
  textureColorSpace?: ColorSpace;
}

export interface TextStyleOverrides {
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string | number;
  fontStyle?: string;
  color?: string;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: "left" | "center" | "right";
}

export interface CreateTextPlaneOptions extends CreatePlaneOptions {
  /** getComputedStyle の抽出結果を個別に上書きする */
  style?: TextStyleOverrides;
  /** Canvas 解像度倍率。既定: min(devicePixelRatio, 2) */
  pixelRatio?: number;
  /** 元 DOM テキストを color: transparent で視覚的に隠す。既定: true */
  hideElementText?: boolean;
  /** element.textContent の代わりに描画するテキスト */
  text?: string;
  /**
   * サイズ変化を伴う resize() のたびに computed style を再解決するか。既定: false。
   * 既定で false なのは、getComputedStyle が強制スタイル再計算(reflow)を招き
   * リサイズ連打時のコストが大きいため。responsive な font-size(clamp 等)や
   * Media Query によるスタイル変更を追従させたい場合のみ true にする。
   * true にせずとも `refreshStyle()` を任意タイミングで呼べば再解決できる。
   */
  refreshStyleOnResize?: boolean;
}

export type Dom3DObjectFitMode = "maxSide" | "contain";

export interface Create3DObjectOptions {
  modelPath: string;
  scale?: number;
  offset?: Offset3D;
  updateRectEveryFrame?: boolean;
  fitMode?: Dom3DObjectFitMode;
}

export interface DOMPositionInfo {
  pageTop: number;
  pageLeft: number;
  isFixed: boolean;
}
