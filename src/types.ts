import * as THREE from "three";
import type { ScrollSyncOptions } from "./ScrollSync";
import type { RafScrollOptions } from "./RafScroll";

// 共通の型定義
export interface Offset3D {
  x: number;
  y: number;
  z: number;
}

export interface WebGLAppOptions {
  enableMouseTracking?: boolean;
  /**
   *  スクロール同期を有効化する。
   * true または ScrollSyncOptions を渡すと、container を `position: absolute` にし、
   * 毎 rAF で 1 回読んだ scrollX/Y を container の transform と DomPlane/Dom3DObject の
   * sceneY 計算の両方に流すことで、rAF↔paint 間に scroll が進んでも DOM ↔ mesh の
   * 相対位置が崩れない設計。
   *
   * CSS scroll-driven animation / animation-timeline は使わない（compositor 駆動にすると
   * JS rAF の sceneY 計算と非同期になり cancel が崩れるため）。
   *
   * @default false
   */
  scrollSync?: boolean | ScrollSyncOptions;
  /**
   * RafScroll（rAF 同期 virtual scroll + touch 慣性）を Core 管理下で有効化する。
   * `true` または {@link RafScrollOptions} を渡すと、Core が `autoStart: false` の
   * RafScroll を構築し、自身の rAF ループ内で `advance()`(= scrollTo) を scroll 読み取りの
   * **前** に駆動する。
   *
   * `new RafScroll()` を別途生成して併用する方法でも動くが、その場合は **WebGLApp より先に**
   * 生成しないと 2 つの rAF ループの登録順しだいで scroll が 1 フレームずれる。この
   * オプション経由なら単一ループに統合されるため、その順序依存を気にしなくてよい（推奨）。
   *
   * 通常 `scrollSync` と併用する。
   *
   * @default false
   */
  rafScroll?: boolean | RafScrollOptions;
  /**
   * stats.js の FPS パネルを画面左上に表示する（開発用）。
   * クリックで FPS / ms / MB を切り替え可能。
   * @default false
   */
  showStats?: boolean;
  /**
   * stats.js panel の append 先。複数の WebGLApp を同一ページで動かしたいときは
   * インスタンスごとに別の要素を指定すると重なりを避けられる。
   * @default document.body
   */
  statsParent?: HTMLElement;
  /**
   * renderer.outputColorSpace の設定。
   * 通常は sRGB のままで OK。displacement 等で Linear 出力が必要な場合のみ
   * THREE.LinearSRGBColorSpace を渡す。
   * @default THREE.SRGBColorSpace
   */
  outputColorSpace?: THREE.ColorSpace;
  /**
   * renderer.setPixelRatio の上限値。
   * モバイル retina (DPR=3) ではピクセル数が ~9 倍になるため、`1.5` 程度に
   * 抑えると GPU 負荷とメモリ帯域が大幅に減る。視覚的には微妙にぼやけるが、
   * スクロールの慣性カクつきが解消されることが多い。
   * @default 2
   */
  maxPixelRatio?: number;
  /**
   * エフェクトを `addEffect()` で読み込んだ時、その effect の `setupGUI()`
   * を自動で呼び出して lil-gui パネルを表示する。
   * GUI 本体は最初に setupGUI を実装したエフェクトが登録された時に lazy 生成される。
   *
   * @default true
   */
  showGUI?: boolean;
  /**
   * lil-gui パネルのタイトル。
   * @default 'Effects'
   */
  guiTitle?: string;
}

export interface CreatePlaneOptions {
  vertexShader?: string;
  fragmentShader?: string;
  uniforms?: { [key: string]: THREE.IUniform };
  updateRectEveryFrame?: boolean;
  /**
   * PlaneGeometry のセグメント数。デフォルト 1（4頂点）。
   * 頂点シェーダーで displacement する場合のみ大きくする。
   * @default 1
   */
  segments?: number;
  /** 要素がビューポートに入ったときに呼ばれるコールバック */
  onInView?: (plane: import('./DomPlane').DomPlane) => void;
  /** 要素がビューポートから出たときに呼ばれるコールバック（inViewRepeat: true のときのみ有効） */
  onOutView?: (plane: import('./DomPlane').DomPlane) => void;
  /**
   * IntersectionObserver の rootMargin。
   *
   * 既定 `'100%'` は **4 方向すべて** に viewport 1 画面分のマージンを取る指定。
   * 縦スクロール用途では「上下に 1 画面ぶん余裕を持って先読み」したいだけのことが多いので、
   * 横方向は不要なら `'100% 0%'` (=上下のみ) を渡す方が判定範囲が狭まり過剰トリガを防げる。
   *
   * @default '100%'
   */
  inViewRootMargin?: string;
  /** trueにすると画面から消えるたびにリセットして再度発火する（デフォルト: false = 1回のみ） */
  inViewRepeat?: boolean;
  /**
   * `data-texture` から読み込む image の `crossOrigin` 属性。
   *
   * - 既定 `'anonymous'`: CORS 認証なしのリクエストを行い、CORS ヘッダを正しく返すサーバ
   *   からの画像のみ受け取れる。WebGL texture / canvas readback 両方使える。
   * - `''`（空文字 = `crossorigin` 属性なし相当）: CORS リクエストをせず、画像自体は表示できる
   *   が、その canvas は **tainted** になり、`getImageData()` などの pixel readback はブロック
   *   される。WebGL texture としては問題なく使える（GLSL 内のサンプリングは OK）。
   * - 任意の文字列（`'use-credentials'` 等）: HTML 画像の `crossorigin` 属性と同じ意味。
   *
   * @default 'anonymous'
   */
  crossOrigin?: string;
}

/**
 * Dom3DObject の bbox フィッティング方法。
 *
 * - `'maxSide'`（既定）: model の bbox を max 辺で正規化し、DOM の max(width, height) に合わせる。
 *   要素が長方形のとき model は長辺方向に最大化される（はみ出さない／背後は埋まらない）。
 * - `'contain'`: DOM の min(width, height) に合わせる。model は要素内に完全に収まる（短辺フィット）。
 * - `'cover'`: DOM の max(width, height) に合わせる。`'maxSide'` と同じだが意味が明確。
 */
export type Dom3DObjectFitMode = "maxSide" | "contain" | "cover";

export interface Create3DObjectOptions {
  modelPath: string;
  scale?: number;
  offset?: Offset3D;
  /** 毎フレームDOMのrectを取り直す（CSSアニメ等で要素が動く場合） */
  updateRectEveryFrame?: boolean;
  /**
   * bbox を DOM サイズに合わせるときの方法。
   * @default 'maxSide'
   */
  fitMode?: Dom3DObjectFitMode;
}

export interface DOMPositionInfo {
  pageTop: number;
  pageLeft: number;
  isFixed: boolean;
}
