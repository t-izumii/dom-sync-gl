import * as THREE from "three";
import { DomPlane } from "./DomPlane";
import {
  resolveTextStyle,
  rasterizeText,
  type ResolvedTextStyle,
} from "./TextRasterizer";
import type { CreateTextPlaneOptions } from "./types";

export class DomTextPlane extends DomPlane {
  private textCanvas!: HTMLCanvasElement;
  private textTexture!: THREE.CanvasTexture;
  private resolvedStyle!: ResolvedTextStyle;
  private text!: string;
  private pixelRatio!: number;
  private hideElementText: boolean;
  private previousInlineColor: string | null = null;
  private hidden = false;
  private resizeObserver: ResizeObserver | null = null;
  private lastRasterWidth = 0;
  private lastRasterHeight = 0;
  // DomPlane.destroyed は private のため自前フラグで判定する。
  private textDestroyed = false;

  constructor(
    el: HTMLElement,
    scene: THREE.Scene,
    canvasRect: DOMRect,
    scroll: { x: number; y: number },
    renderer: THREE.WebGLRenderer,
    options: CreateTextPlaneOptions = {},
    sharedClock?: THREE.Clock,
  ) {
    // super() は内部で init() → loadTexture()（no-op override）→ resize() を同期実行する。
    // その時点でサブクラスフィールドは未初期化のため、resize()/rasterize() 側にガードを置く。
    super(el, scene, canvasRect, scroll, renderer, options, sharedClock);

    this.hideElementText = options.hideElementText ?? true;
    this.text = options.text ?? el.textContent ?? "";
    // color: transparent を当てる前にスタイル（特に色）を抽出しておく。
    this.resolvedStyle = resolveTextStyle(el, options.style);
    this.pixelRatio = options.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 2);

    this.textCanvas = document.createElement("canvas");
    this.textTexture = new THREE.CanvasTexture(this.textCanvas);
    // SRGBColorSpace だとデコードされた linear 値が ShaderMaterial から素通しで
    // 出力されて暗くなるため、生の sRGB 値のまま渡して DOM の文字色と一致させる。
    this.textTexture.colorSpace = THREE.NoColorSpace;
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
    this.textTexture.needsUpdate = true;
  }

  public setText(text: string): void {
    if (this.textDestroyed || !this.element) return;
    this.text = text;
    this.element.textContent = text;
    this.resize();
    // サイズが変わらなくても文字が変わったので必ず描き直す。
    this.rasterize();
  }

  public resize(): void {
    super.resize();
    // super() 経由の早期呼び出し（サブクラスフィールド未初期化）をガードする。
    if (!this.textCanvas) return;
    const rect = this.positionCalculator?.rect;
    if (!rect) return;
    if (rect.width !== this.lastRasterWidth || rect.height !== this.lastRasterHeight) {
      this.rasterize();
    }
  }

  public destroy(): void {
    if (this.textDestroyed) return;
    this.textDestroyed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.hidden && this.element) {
      this.element.style.color = this.previousInlineColor ?? "";
    }
    super.destroy();
  }
}
