import * as THREE from "three/webgpu";
import { DomPlane } from "./DomPlane";
import {
  resolveTextStyle,
  rasterizeText,
  type ResolvedTextStyle,
} from "./TextRasterizer";
import type { CreateTextPlaneOptions, TextStyleOverrides } from "./types";

export class DomTextPlane extends DomPlane {
  private textCanvas!: HTMLCanvasElement;
  private textTexture!: THREE.CanvasTexture;
  private resolvedStyle!: ResolvedTextStyle;
  // refreshStyle() で再解決するため、コンストラクタ時点の上書き指定を保持する。
  private styleOverrides?: TextStyleOverrides;
  private text!: string;
  private pixelRatio!: number;
  private hideElementText: boolean;
  private refreshStyleOnResize: boolean;
  private previousInlineColor: string | null = null;
  private hidden = false;
  private resizeObserver: ResizeObserver | null = null;
  private lastRasterWidth = 0;
  private lastRasterHeight = 0;
  // DomPlane.destroyed は private のため自前フラグで判定する。
  private textDestroyed = false;
  private lastAutoRaster = -Infinity;
  private rasterTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    el: HTMLElement,
    scene: THREE.Scene,
    canvasRect: DOMRect,
    scroll: { x: number; y: number },
    renderer: THREE.WebGPURenderer,
    options: CreateTextPlaneOptions = {},
    sharedClock?: THREE.Clock,
  ) {
    // super() は内部で init() → loadTexture()（no-op override）→ resize() を同期実行する。
    // その時点でサブクラスフィールドは未初期化のため、updateSize()/rasterize() 側にガードを置く。
    super(el, scene, canvasRect, scroll, renderer, options, sharedClock);

    this.hideElementText = options.hideElementText ?? true;
    this.refreshStyleOnResize = options.refreshStyleOnResize ?? false;
    this.styleOverrides = options.style;
    this.text = options.text ?? el.textContent ?? "";
    // color: transparent を当てる前にスタイル（特に色）を抽出しておく。
    this.resolvedStyle = resolveTextStyle(el, this.styleOverrides);
    this.pixelRatio = options.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 2);

    this.textCanvas = document.createElement("canvas");
    this.textTexture = new THREE.CanvasTexture(this.textCanvas);
    // NodeMaterial は画面出力時に linear→sRGB 変換を行うため、入力側も
    // SRGBColorSpace にしてサンプル時に linear へデコードさせる。decode→encode が
    // 相殺され DOM の文字色と一致する（旧 ShaderMaterial の素通し前提から変更）。
    this.textTexture.colorSpace = THREE.SRGBColorSpace;
    this.textTexture.generateMipmaps = false;
    this.textTexture.minFilter = THREE.LinearFilter;
    this.setTexture(this.textTexture, true);

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(el);
    }

    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;

    // 初回のみフォントの読み込みを待つ（resize/setText では再待機しない — スコープ外）。
    if (fonts && fonts.status !== "loaded") {
      // ページのフォントが未ロード: ページ全体のフォント待ち（document.fonts.ready）が
      // 解決したフレームで描画・非表示化する。
      fonts.ready.then(() => {
        if (this.textDestroyed) return;
        this.rasterize();
        this.applyHide();
      });
    } else {
      // fonts 未対応環境、またはページのフォントがロード済み: 待たずに即描画。
      this.rasterize();
      this.applyHide();
    }
  }

  protected loadTexture(): void {}

  private applyHide(): void {
    if (!this.hideElementText || this.hidden || !this.element) return;
    this.hidden = true;
    // visibility/display/opacity は使わない（レイアウト・a11y・SEO・テキスト選択を維持するため）。
    this.previousInlineColor = this.element.style.color || null;
    this.element.style.color = "transparent";
  }

  public rasterize(): void {
    if (
      this.textDestroyed ||
      !this.element ||
      !this.positionCalculator ||
      !this.textCanvas ||
      !this.resolvedStyle
    ) {
      return;
    }
    const rect = this.positionCalculator.rect;
    if (rect.width <= 0 || rect.height <= 0) return;
    const prevCanvasWidth = this.textCanvas.width;
    const prevCanvasHeight = this.textCanvas.height;
    const ok = rasterizeText(
      this.textCanvas,
      this.text,
      this.resolvedStyle,
      rect.width,
      rect.height,
      this.pixelRatio,
    );
    if (!ok) return;
    this.lastRasterWidth = rect.width;
    this.lastRasterHeight = rect.height;
    // canvas の実ピクセルサイズが変わったときは needsUpdate だけでは足りない。
    // GPU 側のテクスチャは旧サイズのまま確保済みで、そこへ新しい canvas を
    // 流し込むと内容が引き伸ばされて出る（padding 変更やレスポンシブな
    // リサイズで再現する）。dispose して次の描画で確保し直させる。
    if (
      this.textCanvas.width !== prevCanvasWidth ||
      this.textCanvas.height !== prevCanvasHeight
    ) {
      this.textTexture.dispose();
    }
    this.textTexture.needsUpdate = true;
  }

  /**
   * computed style を再解決して描き直す。responsive な font-size(clamp)・
   * Media Query・class 変更による color/weight/line-height/padding の変化を
   * テクスチャに反映させたいときに呼ぶ。destroy 済みは no-op。
   */
  public refreshStyle(): void {
    if (this.textDestroyed || !this.element) return;
    this.reresolveStyle();
    this.rasterize();
  }

  private reresolveStyle(): void {
    if (!this.element) return;
    // hideElementText で transparent 化中にそのまま getComputedStyle すると
    // 退避前の色ではなく transparent を拾ってしまうため、元のインライン color を
    // 一時復元してから再解決する。前後の色差し替えは同期処理でフレームを跨がず、
    // 描画上は transparent のままなので画面のちらつきは起きない。
    const restore = this.hidden;
    if (restore) {
      this.element.style.color = this.previousInlineColor ?? "";
    }
    this.resolvedStyle = resolveTextStyle(this.element, this.styleOverrides);
    if (restore) {
      this.element.style.color = "transparent";
    }
  }

  public setText(text: string): void {
    if (this.textDestroyed || !this.element) return;
    this.text = text;
    this.element.textContent = text;
    this.resize();
    // サイズが変わらなくても文字が変わったので必ず描き直す。
    this.rasterize();
  }

  protected updateSize(): void {
    super.updateSize();
    // super() 経由の早期呼び出し（サブクラスフィールド未初期化）をガードする。
    if (!this.textCanvas) return;
    const rect = this.positionCalculator?.rect;
    if (!rect) return;
    if (rect.width !== this.lastRasterWidth || rect.height !== this.lastRasterHeight) {
      const delay = this.resizeInterval - (performance.now() - this.lastAutoRaster);
      if (delay <= 0) {
        this.rasterizeResize();
      } else if (this.rasterTimer === null) {
        this.rasterTimer = setTimeout(() => this.rasterizeResize(), delay);
      }
    }
  }

  private rasterizeResize(): void {
    if (this.rasterTimer !== null) clearTimeout(this.rasterTimer);
    this.rasterTimer = null;
    if (this.textDestroyed) return;
    this.lastAutoRaster = performance.now();
    if (this.refreshStyleOnResize) this.reresolveStyle();
    this.rasterize();
  }

  public destroy(): void {
    if (this.textDestroyed) return;
    this.textDestroyed = true;
    if (this.rasterTimer !== null) clearTimeout(this.rasterTimer);
    this.rasterTimer = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.hidden && this.element) {
      this.element.style.color = this.previousInlineColor ?? "";
    }
    super.destroy();
  }
}
