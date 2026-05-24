/**
 * ScrollSync — WebGL スクロール同期。
 *
 * container 要素を `position: absolute; top: 0; left: 0` で document に貼り、毎 rAF で
 * 1 回読んだ `scrollX/Y` を transform に流す。**同じ scrollX/Y を DomPlane の sceneY 計算
 * にも渡してもらう**ことで、paint 時に scroll が進んで rAF↔paint Δ が出ても container と
 * plane が一緒にズレる → 視覚的に DOM ↔ mesh は完璧に一致する。
 *
 * **scrollHeight 非侵襲**:
 * 単純に `height = viewport * (1 + 2*padding)` を貼ると、container の layout box が
 * `1 + 2*padding` 倍の高さを占有し、body の scrollHeight を底上げしてしまう
 * （コンテンツが短いページや、スクロール末尾で「実コンテンツを越えて余白までスクロール」
 *  できる現象）。
 *
 * 対策として **毎フレ effective padding を `body.scrollHeight - scrollY - viewport`
 * でクランプ**する（`#updateCanvasSize` と同じ formula）。
 *   - 長いページ + 上の方にいる: requested = effective（フル padding）
 *   - 末尾に近づく: max が縮み effective も縮む → container も縮む
 *   - 末尾ぴったり: effective = 0 → container = viewport ぴったり
 *
 * canvas drawing buffer も同期して resize する必要があるため、resize 通知 callback を
 * `setResizeCallback()` で受け取る。Core 側でこの callback に `renderer.setSize` /
 * `camera.resize` / `postEffect.resize` を繋ぐ。
 *
 */

export interface ScrollSyncOptions {
  /**
   * 上下パディング比率（0〜1）。canvas の高さを viewport * (1 + padding * 2) にし、
   * rAF↔paint 間の scroll 進行で canvas が viewport から欠ける現象を吸収する。
   * 末尾に近づくと effective 値は自動でクランプされ、body.scrollHeight を底上げしない。
   * @default 0
   */
  padding?: number;

  /**
   * スクロール強度（速度）を strength getter で提供するか。
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
  private _padding: number;
  private _trackStrength: boolean;
  private _strengthDecay: number;
  private _strength: number = 0;
  private _prevScrollY: number = 0;
  private _prevTime: number = 0;
  private _viewportWidth: number = 0;
  private _viewportHeight: number = 0;
  private _enabled: boolean = true;

  /**
   * container の **元 CSS 指定** を window に対する比率として保持する。
   *
   * 例: container の CSS が `width: 100vw; height: 110vh` なら
   *   _widthRatio = 1.0, _heightRatio = 1.1
   *
   * `applyContainerStyles()` で container は `position: absolute; width/height = JS制御`
   * に書き換えられて以降「元の CSS による intrinsic size」は測れなくなる。よって
   * **constructor 進入時** に getBoundingClientRect から ratio を snapshot し、以降の
   * resize ではこの ratio を window 寸法に掛けて canvas 物理サイズを決める。
   *
   * これにより `#canvas { width: 100vw; height: 110vh; }` のような CSS が
   * window resize / orientation 変更後も「100vw × 110vh」相当を保ち続ける。
   */
  private _widthRatio: number = 1;
  private _heightRatio: number = 1;

  /**
   * 現在 transform / canvas 寸法に反映している padding 値（px）。
   * クランプの出力。`_padding * viewportHeight` の上限と、document の余り
   * 領域の最小から決まる。
   */
  private _effectivePaddingPx: number = 0;

  /** 計算用の canvas rect（scroll transform を含まない論理 rect、effective padding 基準） */
  private _logicalRect: DOMRect = new DOMRect();

  /**
   * effective padding が変わって canvas drawing buffer の resize が必要な時に呼ぶ callback。
   * 引数は `{ width, height }`（drawing buffer の新サイズ = container の新サイズ）。
   * Core 側でこれに `renderer.setSize` / `camera.resize` / `postEffect.resize` をぶら下げる。
   */
  private _onResize: ((size: { width: number; height: number }) => void) | null = null;

  /**
   * destroy 時の復元用に、constructor 進入時の inline style を退避しておく。
   * ユーザーが先に `container.style.position = 'relative'` などを当てていた場合に、
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
    this._padding = options.padding ?? 0;
    this._trackStrength = options.trackStrength ?? false;
    this._strengthDecay = options.strengthDecay ?? 10;
    this._prevScrollY = window.scrollY;
    this._prevTime = performance.now() / 1000;

    // 元 inline style を snapshot（destroy 時に復元するため）。
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

    // applyContainerStyles 前に container の CSS-computed rect を測り、window 寸法に
    // 対する比率を snapshot する。CSS の vw/vh 等で書かれた指定はこの時点で window に
    // 応じた px 値として評価済みなので、ratio として保存しておけば後の resize でも
    // 「同じ CSS 指定」を再現できる。
    //
    // container がまだ layout されていない (display:none / jsdom 環境 / size 未指定で
    // 0px 扱い) ケースでは ratio = 0 になって canvas が潰れるので、その場合は default 1.0
    // (= window 寸法そのまま) のまま落とす。
    const initialRect = container.getBoundingClientRect();
    if (window.innerWidth > 0 && initialRect.width > 0) {
      this._widthRatio = initialRect.width / window.innerWidth;
    }
    if (window.innerHeight > 0 && initialRect.height > 0) {
      this._heightRatio = initialRect.height / window.innerHeight;
    }

    this.applyContainerStyles();
    this.updateSize();
  }

  private applyContainerStyles(): void {
    this.container.style.position = 'absolute';
    this.container.style.left = '0';
    this.container.style.top = '0';
    // 子の canvas overflow を視覚的にクリップ。drawing buffer を resize していない瞬間に
    // visual artifact が出ないようにするため。
    this.container.style.overflow = 'hidden';
    this.container.style.pointerEvents = 'none';
    this.container.style.willChange = 'transform';
  }

  /**
   * ビューポートサイズが変わった時に呼ぶ。effective padding は requested で初期化し、
   * 次の update() 呼び出しでクランプが効く。
   *
   * 引数を省略した場合は、constructor で snapshot した container の CSS ratio を
   * window 寸法に掛けて自動算出する。明示的に値を渡せば override 可能（scrollbar を
   * 差し引いた幅にしたい等のケース）。
   */
  updateSize(wrapperWidth?: number, wrapperHeight?: number): void {
    this._viewportWidth = wrapperWidth ?? window.innerWidth * this._widthRatio;
    this._viewportHeight =
      wrapperHeight ?? window.innerHeight * this._heightRatio;

    // resize 直後は full padding で開始（次の update() でクランプされる）。
    const requestedPaddingPx = this._viewportHeight * this._padding;
    this._effectivePaddingPx = requestedPaddingPx;

    const canvasHeight = this._viewportHeight + 2 * requestedPaddingPx;

    this.container.style.width = `${this._viewportWidth}px`;
    this.container.style.height = `${canvasHeight}px`;

    this._logicalRect = new DOMRect(
      0,
      -requestedPaddingPx,
      this._viewportWidth,
      canvasHeight,
    );

    // resize callback を発火（Core 側で renderer.setSize 等を呼ばせる）
    this._onResize?.({ width: this._viewportWidth, height: canvasHeight });

    // 現在のスクロール位置で transform を即時反映（初期化・リサイズ直後の表示崩れ防止）
    this.applyTransform(window.scrollX, window.scrollY);
  }

  /**
   * 毎 rAF で呼ぶ。**plane の sceneY 計算と同一の scrollX/Y を渡すこと**。
   * これが cancel の不変条件。
   *
   * padding clamp:
   *   maxPaddingY = body.scrollHeight - scrollY - viewportHeight
   *   effective   = clamp(requested, 0, maxPaddingY)
   * effective が変わったら canvas drawing buffer も同期して resize する。
   */
  update(scrollX: number, scrollY: number): void {
    if (!this._enabled) return;

    // === per-frame padding clamp　===
    const requestedPaddingPx = this._viewportHeight * this._padding;
    const maxPaddingPx = Math.max(
      0,
      document.body.scrollHeight - scrollY - this._viewportHeight,
    );
    const effective = Math.min(requestedPaddingPx, maxPaddingPx);

    if (effective !== this._effectivePaddingPx) {
      this._effectivePaddingPx = effective;
      const newHeight = this._viewportHeight + 2 * effective;
      this.container.style.height = `${newHeight}px`;
      this._logicalRect = new DOMRect(
        0,
        -effective,
        this._viewportWidth,
        newHeight,
      );
      this._onResize?.({ width: this._viewportWidth, height: newHeight });
    }

    this.applyTransform(scrollX, scrollY);
    if (this._trackStrength) {
      this.updateStrength(scrollY);
    }
  }

  private applyTransform(scrollX: number, scrollY: number): void {
    // formula。effective padding を使うことで「末尾で padding が縮んだ時に
    // canvas が消えそうな位置にずれる」現象も自然に解決する（padding=0 なら canvas は
    // viewport にぴったり）。
    this.container.style.transform =
      `translate3d(${scrollX}px, ${scrollY - this._effectivePaddingPx}px, 0)`;
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
   * DomPositionCalculator 用の **論理** rect。
   *
   * **注意**: これは「ブラウザ上での canvas の getBoundingClientRect」ではない。
   * `top = -effectivePadding`, `height = viewport + 2 * effectivePadding` で、
   * scroll に追従して動く container 内のローカル座標系を表す。effective padding は
   * 末尾近くで自動的に縮む。
   */
  get logicalRect(): DOMRect {
    return this._logicalRect;
  }

  /** 現在の effective padding（px）。テスト・デバッグ用。 */
  get effectivePadding(): number {
    return this._effectivePaddingPx;
  }

  /**
   * 現在のスクロール速度（0〜1 にクランプ）。
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

  get padding(): number {
    return this._padding;
  }

  /**
   * 入力受付の有効/無効。
   *
   * disable 中は `update()` が no-op になり container の transform は触らない（disable 直前の
   * 位置で固定される）。enable に戻したフレから transform 更新が再開する。
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
    // constructor で snapshot した元 inline style に戻す。
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
