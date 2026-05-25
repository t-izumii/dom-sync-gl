/**
 * ScrollSync — WebGL canvas を viewport に固定する薄いレイヤ。
 *
 * container 要素を `position: fixed; inset: 0` で viewport にロックし、canvas のサイズを
 * window 寸法に合わせて保つだけ。per-frame の transform 適用は持たない。
 *
 * **なぜ fixed か**:
 * 旧実装では container を `position: absolute` で document に貼り、毎 rAF で
 * `translate3d(0, scrollY, 0)` を当てて「視覚的には viewport 固定だが layout 上は scroll
 * と一緒に動く」状態を作っていた。これは rAF↔paint Δ を吸収する狙いだったが、iOS Safari の
 * 上端 rubber-band / pull-to-refresh と相性が悪い:
 *
 *   1. rubber-band 中、body は視覚的に下にスライド (=absolute の container も一緒に滑る)
 *   2. `getBoundingClientRect()` は visual viewport 基準で返るので DOM 要素も視覚オフセット
 *      込みの top を返す
 *   3. plane 位置を BCR から計算する以上、plane 自体も視覚オフセット分ずれる
 *   4. **container 自体も同じだけ滑っているので、plane は二重に下にズレて見える**
 *
 * fixed なら container が rubber-band で動かない (= viewport に固定) ので、plane が BCR の
 * 視覚オフセットを取り込んでも canvas 側にはそのオフセットがなく、結果として DOM 要素と
 * plane が同じ位置に揃う。
 *
 * **rAF↔paint Δ の扱い**:
 * fixed container では canvas 自体は scroll で動かないので、rAF tick 上で読んだ scrollY を
 * plane の位置計算に使うとき、paint までに native scroll が進んでも plane 位置 (= scrollY 由来
 * の補正量) と DOM の見た目 (= native scroll で進んだ位置) が 1 frame ずれる。これを完璧に
 * 揃えたい場合は `RafScroll` を併用する (wheel/touch を rAF tick に集約 → JS と paint の
 * scrollY が同値になる)。 RafScroll なしでも体感的なズレは小さい。
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

  /** viewport そのままの logical rect。canvas drawing buffer のサイズに使う。 */
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
    pointerEvents: string;
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
      pointerEvents: s.pointerEvents,
    };

    this.applyContainerStyles();
    this.updateSize();
  }

  private applyContainerStyles(): void {
    this.container.style.position = 'fixed';
    this.container.style.left = '0';
    this.container.style.top = '0';
    // 子の canvas が描画 buffer resize 直後に visual artifact を出さないようクリップ。
    this.container.style.overflow = 'hidden';
    // canvas が viewport を覆うので、下にある DOM 要素のクリックを透過させる。
    this.container.style.pointerEvents = 'none';
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
  }

  /**
   * 毎 rAF で呼ぶ。fixed container 化で transform 操作は不要になったため、
   * このメソッドの実体は strength tracking のみ。`scrollX` は将来の拡張用に残してある
   * (現在は未使用)。
   */
  update(_scrollX: number, scrollY: number): void {
    if (!this._enabled) return;
    if (this._trackStrength) {
      this.updateStrength(scrollY);
    }
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
   * fixed container 化により scroll で変動しない。
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
   * disable 中は `update()` が no-op になり strength tracking が止まる。container は
   * fixed のまま動かない (transform を持たないため freezing は不要)。
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
    s.pointerEvents = o.pointerEvents;
  }
}
