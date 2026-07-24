import * as THREE from "three";
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
  outputColorSpace?: THREE.ColorSpace;
  maxPixelRatio?: number;
  /**
   * 内部で requestAnimationFrame ループを回すか。
   * - true（既定）: ライブラリが自前で毎フレーム描画する（Lenis なしの単体利用向け）。
   * - false: 内部ループを止める。アプリ側の rAF から `app.tick(time)` を呼んで駆動する。
   *   Lenis 等のスムーズスクロールと 1 本の rAF で順序を保証したい場合に使う。
   */
  autoRaf?: boolean;
  /** 呼び出し元が生成した lil-gui インスタンス。渡された場合のみ setupGUI() 系のフックが有効になる（生成・破棄は呼び出し元の責務）。 */
  gui?: GUI | null;
  /** 呼び出し元が生成した stats.js インスタンス。渡された場合のみ毎フレーム begin()/end() を呼ぶ（DOM への挿入・破棄は呼び出し元の責務）。 */
  stats?: Stats | null;
}

export interface CreatePlaneOptions {
  vertexShader?: string;
  fragmentShader?: string;
  /**
   * 追加のカスタム uniform。以下の予約名は DomPlane が内部で生成・毎フレーム
   * 更新するため渡せない（渡すと throw する）:
   * `uTexture` / `uAlpha` / `uResolution` / `uTime` / `uIsHovered` / `uMouseUV`。
   */
  uniforms?: { [key: string]: THREE.IUniform };
  updateRectEveryFrame?: boolean;
  segments?: number;
  onInView?: (plane: import('./DomPlane').DomPlane) => void;
  onOutView?: (plane: import('./DomPlane').DomPlane) => void;
  inViewRootMargin?: string;
  inViewRepeat?: boolean;
  crossOrigin?: string;
  /**
   * data-texture で読み込むテクスチャの色空間。
   * 既定は `NoColorSpace`: shader は生の sRGB 値をそのまま受け取り、DOM の画像と
   * 表示が一致する。`SRGBColorSpace` を指定するとサンプル値が linear になるため、
   * sRGB への出力変換は自前の shader で行う必要がある。
   */
  textureColorSpace?: THREE.ColorSpace;
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
