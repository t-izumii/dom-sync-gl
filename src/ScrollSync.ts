/**
 * ScrollSync — WebGL canvas を絶対配置で document に貼り、毎 rAF で
 * 実効 scrollY を transform に流して viewport に追従させる薄いレイヤ。
 *
 * **container は position: absolute (絶対条件)**:
 * iframe 内 / `<dialog>` 内 / 祖先に transform を持つ要素がある等、`position: fixed` が
 * 期待通りに viewport に固定されない / 別の containing block に張り付くケースがあるため、
 * 本ライブラリは absolute を採用する。
 *
 * **実効 scrollY = `-document.documentElement.getBoundingClientRect().top`**:
 * 通常スクロール中は `documentElement.BCR.top = -window.scrollY` なので
 * `effectiveScrollY === window.scrollY` で従来挙動と一致する。iOS Safari の上端
 * rubber-band / pull-to-refresh 中だけは visual viewport が下にずれて
 * `documentElement.BCR.top = visual_offset (>0)` となり、`effectiveScrollY` は負に振れる。
 *
 * これを transform に当てると container が visual_offset 分だけ上に押し戻されるため、
 * body 全体が rubber-band で下にスライドしても canvas 描画域は視覚的に layout viewport
 * 上端に留まる。DOM-locked plane は BCR ベースの位置計算で同じ visual_offset を取り込む
 * ので、両者は同じ視覚オフセットを持たず → DOM ↔ mesh の位置が rubber-band 中も揃う。
 *
 * **同じ effectiveScrollY を plane の sceneY 計算にも渡してもらう**ことで、paint 時に
 * scroll が進んで rAF↔paint Δ が出ても container と plane が一緒にズレる → 視覚的に
 * DOM ↔ mesh は完璧に一致する (これは旧設計から引き続き成立)。
 */

export interface ScrollSyncOptions {
  /**
   * スクロール強度 (速度) を strength getter で提供するか。
   * @default false
   */
  trackStrength?: boolean;

  /**
   * strength の減衰速度。
   * @default 10
   */
  strengthDecay?: number;
}

export class ScrollSync {
  private container: HTMLElement;
  private _trackStrength: boolean;
  private _strengthDecay: number;
  private _strength: number = 0;
  private _prevScrollY: number = 0;
  private _prevTime: number = 0;
  private _viewportWidth: number = 0;
  private _viewportHeight: number = 0;
  private _enabled: boolean = true;

  /** viewport そのままの logical rect (0, 0, vw, vh)。canvas drawing buffer のサイズに使う。 */
  private _logicalRect: DOMRect = new DOMRect();

  /**
   * canvas drawing buffer の resize が必要な時に呼ぶ callback。
   * Core 側でこれに `renderer.setSize` / `camera.resize` / `postEffect.resize` をぶら下げる。
   */
  private _onResize: ((size: { width: number; height: number }) => void) | null = null;

  /**
   * destroy 時の復元用に、constructor 進入時の inline style を退避する。
   * ユーザーが先に `container.style.position = 'relative'` 等を当てていた場合に、
   * destroy で「空文字に潰す」ではなく元の値に戻すために必要。
   */
  private _originalStyles: {
    position: string;
    left: string;
    top: string;
    width: string;
    height: string;
    overflow: string;
    transform: string;
    pointerEvents: string;
    willChange: string;
  };

  constructor(container: HTMLElement, options: ScrollSyncOptions = {}) {
    this.container = container;
    this._trackStrength = options.trackStrength ?? false;
    this._strengthDecay = options.strengthDecay ?? 10;
    this._prevScrollY = window.scrollY;
    this._prevTime = performance.now() / 1000;

    const s = container.style;
    this._originalStyles = {
      position: s.position,
      left: s.left,
      top: s.top,
      width: s.width,
      height: s.height,
      overflow: s.overflow,
      transform: s.transform,
      pointerEvents: s.pointerEvents,
      willChange: s.willChange,
    };

    this.applyContainerStyles();
    this.updateSize();
  }

  private applyContainerStyles(): void {
    this.container.style.position = 'absolute';
    this.container.style.left = '0';
    this.container.style.top = '0';
    // 子の canvas が描画 buffer resize 直後に visual artifact を出さないようクリップ。
    this.container.style.overflow = 'hidden';
    // canvas が viewport を覆うので、下にある DOM 要素のクリックを透過させる。
    this.container.style.pointerEvents = 'none';
    this.container.style.willChange = 'transform';
  }

  /**
   * viewport サイズが変わった時に呼ぶ。引数省略で window 寸法から自動算出。
   * 明示的に値を渡せば override 可能 (scrollbar 差し引いた幅にしたい等)。
   */
  updateSize(wrapperWidth?: number, wrapperHeight?: number): void {
    this._viewportWidth = wrapperWidth ?? window.innerWidth;
    this._viewportHeight = wrapperHeight ?? window.innerHeight;

    this.container.style.width = `${this._viewportWidth}px`;
    this.container.style.height = `${this._viewportHeight}px`;

    this._logicalRect = new DOMRect(
      0,
      0,
      this._viewportWidth,
      this._viewportHeight,
    );

    this._onResize?.({ width: this._viewportWidth, height: this._viewportHeight });

    // 初期化・リサイズ直後の表示崩れ防止: 現在の scroll 位置で即座に transform を反映
    this.applyTransform(window.scrollX, ScrollSync.computeEffectiveScrollY());
  }

  /**
   * 毎 rAF で呼ぶ。**plane の sceneY 計算と同一の effectiveScrollY を渡すこと**。
   * これが「rAF↔paint Δ で container と plane が一緒にズレる」不変条件を満たすキー。
   *
   * effectiveScrollY は Core 側で `ScrollSync.computeEffectiveScrollY()` を 1 回呼んで
   * scrollSync.update / plane._tickApply / dom3D._tickApply に同値で配ること。
   */
  update(scrollX: number, scrollY: number): void {
    if (!this._enabled) return;
    this.applyTransform(scrollX, scrollY);
    if (this._trackStrength) {
      this.updateStrength(scrollY);
    }
  }

  private applyTransform(scrollX: number, scrollY: number): void {
    this.container.style.transform =
      `translate3d(${scrollX}px, ${scrollY}px, 0)`;
  }

  /**
   * 実効 scrollY を返す。
   *
   * `-document.documentElement.getBoundingClientRect().top` を返すことで、通常スクロール時は
   * `window.scrollY` と一致し、iOS Safari の rubber-band / pull-to-refresh 中は visual
   * viewport の offset を取り込んだ値 (top の rubber-band 中は負) を返す。
   *
   * このメソッドを Core.animate の 1 frame で 1 回呼び、scrollSync.update / plane._tickApply
   * など全位置計算に同値で配ることで、rubber-band 中も container と plane が同じ視覚オフセット
   * を共有して DOM と揃う。
   */
  static computeEffectiveScrollY(): number {
    return -document.documentElement.getBoundingClientRect().top;
  }

  /** スクロール速度ベースの strength 値を更新。 */
  private updateStrength(scrollY: number): void {
    const scrollDelta = scrollY - this._prevScrollY;
    const now = performance.now() / 1000;
    const dt = now - this._prevTime;

    if (dt > 0) {
      const targetStrength =
        (Math.abs(scrollDelta) * 10) / this._viewportHeight;
      this._strength *= Math.exp(-dt * this._strengthDecay);
      this._strength += Math.min(targetStrength, 5);
    }

    this._prevScrollY = scrollY;
    this._prevTime = now;
  }

  /**
   * canvas drawing buffer の resize が必要な時に呼ばれる callback を登録する。
   * @internal Core 側で renderer.setSize / camera.resize / postEffect.resize を繋ぐ。
   */
  setResizeCallback(cb: (size: { width: number; height: number }) => void): void {
    this._onResize = cb;
  }

  /**
   * DomPositionCalculator 用の論理 rect。viewport ぴったりの (0, 0, vw, vh)。
   * container の transform は毎 rAF で applyTransform が当てるので、ここでは scroll 補正
   * を入れない (transform 経由で吸収される)。
   */
  get logicalRect(): DOMRect {
    return this._logicalRect;
  }

  /**
   * 現在のスクロール速度 (0〜1 にクランプ)。
   *
   * **`trackStrength: false` で構築している場合は常に 0 を返す**。値を使いたい場合は
   * options で trackStrength を true にして構築すること。DEV では誤用防止のため
   * 1 度だけ console.warn を出す。
   */
  get strength(): number {
    if (!this._trackStrength) {
      if (import.meta.env?.DEV && !this._warnedStrength) {
        this._warnedStrength = true;
        console.warn(
          '[ScrollSync] strength は trackStrength: true で初期化した時のみ意味のある値を返します。' +
          ' 現在は trackStrength=false なので常に 0 です。'
        );
      }
      return 0;
    }
    return Math.min(1, this._strength);
  }
  private _warnedStrength: boolean = false;

  /**
   * 入力受付の有効/無効。
   *
   * disable 中は `update()` が no-op になり container の transform は触らない (disable 直前の
   * 位置で固定される)。enable に戻したフレから transform 更新が再開する。
   *
   * disable で「container を素の状態に戻したい」場合は `destroy()` を呼ぶこと。
   */
  set enabled(value: boolean) {
    this._enabled = value;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  destroy(): void {
    const o = this._originalStyles;
    const s = this.container.style;
    s.position = o.position;
    s.left = o.left;
    s.top = o.top;
    s.width = o.width;
    s.height = o.height;
    s.overflow = o.overflow;
    s.transform = o.transform;
    s.pointerEvents = o.pointerEvents;
    s.willChange = o.willChange;
  }
}
