/**
 * RafScroll — rAF 同期 virtual scroll の最小実装。
 *
 * wheel / touch を `preventDefault` で受け取り、内部 accumulator に加算した値を
 * 毎 rAF tick で `window.scrollTo()` に流す。
 *
 * これにより:
 * - `window.scrollY` が **rAF tick 上でのみ更新**される
 * - JS rAF 時の `window.scrollY` と paint 時の actual scroll が同一フレームで揃う
 * - ScrollSync の cancel (container.transform と sceneY 計算で同じ scrollY を
 *   共有する不変条件) が paint 時まで厳密に成立する
 *
 * Lenis から「rAF 同期に必要な最小機能」だけ抜き出した実装。wheel/drag 中の smoothing
 * は無し (`lerp: 1` 相当)、accessibility (キーボードスクロール) や programmatic scroll
 * (`window.scrollTo` 外部呼び出し) との同期は対応しない。
 *
 * **touch 慣性 (momentum)**: ネイティブ touch scroll を `preventDefault` で抑止する以上、
 * OS が提供する慣性も失われる。代わりに自前で実装する:
 * - `touchmove` で指の速度 (px/ms) を EMA 平滑化しつつ追跡
 * - `touchend` 時点の velocity を初速として rAF tick 上で指数減衰させて scrollY に積む
 * - 端到達 (clamp) / 次の touchstart / wheel 入力で慣性は即キャンセル
 *
 * **native pull-to-refresh / overscroll**: 全 touchmove を preventDefault するとモバイル
 * 上端での「下方向 swipe でリロード」のような OS / ブラウザ標準のジェスチャーまで殺して
 * しまう。これを救うため、`touchstart` 時点で `scrollY <= 0` (= ページ最上部) かつ最初の
 * touchmove が下方向の場合だけ preventDefault せず native に任せる。逆方向に動いた瞬間
 * (= 普通の下スクロール) は内部処理に取り込み、以降そのジェスチャーが終わるまでは native
 * へ戻さない。
 *
 * @see https://github.com/darkroomengineering/lenis (元設計)
 */

export interface RafScrollOptions {
  /**
   * `WheelEvent.deltaMode === DOM_DELTA_LINE` のとき 1 行あたりの pixel 数。
   * Firefox の wheel が deltaMode=1 を返すケースで使われる。
   * @default 16
   */
  lineHeight?: number;
  /**
   * touch リリース後の慣性減衰率。16.67ms 換算 1 フレームあたり velocity に乗算される値。
   * 1 に近いほど慣性が長く続き、0 に近いほどすぐ止まる。0 で慣性無効 (即時停止)。
   * @default 0.95
   */
  touchFriction?: number;
  /**
   * 自前の `requestAnimationFrame` ループを起動するか。
   *
   * - `true`（既定 / スタンドアロン利用）: 内部で rAF ループを回し、毎フレーム
   *   `window.scrollTo()` を確定させる。
   * - `false`（管理モード）: 内部ループを起動せず、所有者が毎フレーム {@link RafScroll.advance}
   *   を呼んで 1 歩進める。`WebGLApp({ rafScroll })` がこのモードで構築し、Core の **単一**
   *   rAF ループ内で `advance()`（= scrollTo）を `scroll 読み取り` より前に走らせることで、
   *   「RafScroll と Core が別々の rAF ループを持ち、生成順しだいで scroll が 1 フレームずれる」
   *   問題を構造的に排除する。
   *
   * @default true
   */
  autoStart?: boolean;
}

/** 慣性を停止する velocity の閾値 (px/ms)。これを下回ったら 0 に丸める。 */
const MIN_VELOCITY = 0.01;
/** touchend 時、最終 touchmove からこれ以上経過していたら velocity を捨てる (ms)。 */
const VELOCITY_CUTOFF_MS = 50;
/** EMA の新サンプル重み。大きいほど直近の velocity を強く反映、小さいほどノイズ耐性。 */
const VELOCITY_EMA_ALPHA = 0.3;
/** dt 正規化の基準フレーム時間 (60fps = 16.67ms)。 */
const FRAME_MS = 1000 / 60;

export class RafScroll {
  private _scrollY: number;
  /**
   * 直近 `window.scrollTo` に渡した値。scrollY が変わっていないフレで
   * scrollTo を no-op で呼ぶと scroll event が連発して page 側 listener を
   * 無駄に叩くので、差分があるときだけ呼び出すための diff キャッシュ。
   */
  private _lastAppliedY: number;
  private _maxScroll: number;
  private _rafId: number = 0;
  private _enabled: boolean = true;
  private _lineHeight: number;
  private _friction: number;
  /** 自前 rAF ループを起動するか（false = 所有者が advance() で駆動する管理モード）。 */
  private _autoStart: boolean;
  private _touchPrevY: number = 0;
  private _touchPrevTime: number = 0;
  /** 直近の touch velocity (px/ms)。touchend 後はこの値を初速に慣性が走る。 */
  private _velocityY: number = 0;
  private _isTouching: boolean = false;
  /**
   * このタッチシーケンスで native pull-to-refresh を許可するか。
   * `touchstart` 時点で `scrollY <= 0` なら true。最初の touchmove が上方向に動いた
   * (= 内部 scroll を進める意図) 時点で false に落として、以降このタッチ中はずっと
   * preventDefault する。
   */
  private _allowNativePull: boolean = false;
  /** tick() の dt 計算用。0 のとき初回 tick (dt は FRAME_MS で初期化)。 */
  private _lastTickTime: number = 0;
  private _eventAbort: AbortController = new AbortController();
  private _resizeObserver: ResizeObserver | null = null;
  private _destroyed: boolean = false;

  constructor(options: RafScrollOptions = {}) {
    this._lineHeight = options.lineHeight ?? 16;
    this._friction = options.touchFriction ?? 0.95;
    this._autoStart = options.autoStart ?? true;
    this._scrollY = window.scrollY;
    this._lastAppliedY = this._scrollY;
    this._maxScroll = this.calcMaxScroll();

    this.setupEventListeners();
    this.setupResizeObserver();
    // 管理モード (autoStart: false) では所有者が advance() で駆動するので自前ループは回さない。
    if (this._autoStart) {
      this._rafId = requestAnimationFrame(this.tick);
    }
  }

  private calcMaxScroll(): number {
    return Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    );
  }

  private setupEventListeners(): void {
    const signal = this._eventAbort.signal;

    // wheel: passive=false で preventDefault して native scroll を抑止
    window.addEventListener('wheel', this.onWheel, {
      passive: false,
      signal,
    });

    // touch (passive=false で preventDefault → native scroll/慣性を抑止し自前で再現)
    window.addEventListener('touchstart', this.onTouchStart, {
      passive: false,
      signal,
    });
    window.addEventListener('touchmove', this.onTouchMove, {
      passive: false,
      signal,
    });
    window.addEventListener('touchend', this.onTouchEnd, {
      passive: true,
      signal,
    });
    window.addEventListener('touchcancel', this.onTouchEnd, {
      passive: true,
      signal,
    });

    // viewport / document サイズ変化に追従
    window.addEventListener('resize', this.onResize, { signal });
  }

  /**
   * document の scrollHeight が動的に変わる場合 (画像 lazy load、SPA でのコンテンツ追加 等)
   * に maxScroll を追従させる。ResizeObserver で `<html>` を観察する。
   */
  private setupResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this._resizeObserver = new ResizeObserver(() => {
      this._maxScroll = this.calcMaxScroll();
      this._scrollY = this.clamp(this._scrollY);
    });
    this._resizeObserver.observe(document.documentElement);
  }

  private onWheel = (e: WheelEvent): void => {
    if (!this._enabled) return;
    e.preventDefault();
    // wheel 入力が来たら触っていた慣性は捨てる (Lenis 等と同じ挙動)
    this._velocityY = 0;
    let delta = e.deltaY;
    // deltaMode: 0=PIXEL, 1=LINE, 2=PAGE
    if (e.deltaMode === 1) delta *= this._lineHeight;
    else if (e.deltaMode === 2) delta *= window.innerHeight;
    this._scrollY = this.clamp(this._scrollY + delta);
  };

  private onTouchStart = (e: TouchEvent): void => {
    if (!this._enabled) return;
    if (e.touches.length === 0) return;
    // 既存の慣性を即キャンセル (指を置いた瞬間に止まる挙動)
    this._velocityY = 0;
    this._isTouching = true;
    this._touchPrevY = e.touches[0].clientY;
    this._touchPrevTime = performance.now();
    // ページ最上部で始まったタッチは、最初の動きが下方向なら native pull-to-refresh
    // (iOS Safari / Android Chrome) を許可する候補。touchmove で方向を見て確定する。
    this._allowNativePull = this._scrollY <= 0;
  };

  private onTouchMove = (e: TouchEvent): void => {
    if (!this._enabled) return;
    if (e.touches.length === 0) return;

    const y = e.touches[0].clientY;
    const now = performance.now();
    const dy = this._touchPrevY - y;
    const dt = now - this._touchPrevTime;

    // 最上部 + 下方向 swipe (または無方向) なら native pull-to-refresh に委ねる。
    // preventDefault せず、内部 scroll / velocity も更新しないことで、ブラウザの
    // 標準ジェスチャー (リロード等) をそのまま発火させる。
    // dy === 0 (= 動いていない) も含める: 1 frame 目に finger jitter で 0 が来ても
    // preventDefault してしまうと iOS Safari がそのジェスチャーで pull-to-refresh
    // を発火しなくなる。
    if (this._allowNativePull && dy <= 0) {
      this._touchPrevY = y;
      this._touchPrevTime = now;
      return;
    }

    // 一度でも内部スクロールに取り込んだら、このタッチが終わるまで native へは戻さない
    // (途中で「下方向に折り返したら急に native pull が起動する」のを防ぐ)。
    this._allowNativePull = false;

    e.preventDefault();

    this._scrollY = this.clamp(this._scrollY + dy);

    // 瞬間 velocity を EMA で平滑化 (タッチ入力は jitter が大きいので生 dy/dt は使わない)
    if (dt > 0) {
      const instantV = dy / dt;
      this._velocityY =
        this._velocityY * (1 - VELOCITY_EMA_ALPHA) +
        instantV * VELOCITY_EMA_ALPHA;
    }

    this._touchPrevY = y;
    this._touchPrevTime = now;
  };

  private onTouchEnd = (): void => {
    this._isTouching = false;
    // 指を持ち上げる直前に止めていた場合 (最終 touchmove から間が空いている) は
    // 慣性を発火しない。古い velocity が残って意図しない flick になるのを防ぐ。
    if (performance.now() - this._touchPrevTime > VELOCITY_CUTOFF_MS) {
      this._velocityY = 0;
    }
  };

  private onResize = (): void => {
    this._maxScroll = this.calcMaxScroll();
    this._scrollY = this.clamp(this._scrollY);
  };

  private clamp(y: number): number {
    return Math.min(this._maxScroll, Math.max(0, y));
  }

  /**
   * 毎 rAF で `window.scrollTo` を呼ぶ。これが Lenis 方式の核心:
   * scrollY の更新タイミングを「JS rAF tick 上だけ」に集約することで、
   * paint 時に見える scrollY と JS が知る scrollY が完全一致する。
   *
   * 同値時は no-op で呼ばない (scroll event の連発で page 側 listener を
   * 叩くのを避ける)。
   *
   * touch リリース後の慣性: `_velocityY` が閾値以上ある間、毎 tick で
   * `scrollY += velocity * dt` を積みつつ `velocity *= friction^(dt/FRAME_MS)` で減衰。
   */
  /**
   * 1 フレーム分の積分 + `window.scrollTo`。rAF ループの有無に依存しない純粋な「1 歩」。
   * 自前ループ ({@link RafScroll.tick}) と管理モード ({@link RafScroll.advance}) の両方から呼ぶ。
   */
  private step(now: number): void {
    if (this._destroyed) return;

    // dt 正規化 (frame rate 非依存)。初回は基準フレーム時間で扱う。
    const dt = this._lastTickTime === 0 ? FRAME_MS : now - this._lastTickTime;
    this._lastTickTime = now;

    // 慣性: touch 中でなく velocity が残っていれば積分
    if (!this._isTouching && Math.abs(this._velocityY) > MIN_VELOCITY) {
      const before = this._scrollY;
      const next = this.clamp(this._scrollY + this._velocityY * dt);
      this._scrollY = next;
      // clamp に当たって動かなかった (端到達) なら velocity を捨てる
      if (next === before) {
        this._velocityY = 0;
      } else {
        this._velocityY *= Math.pow(this._friction, dt / FRAME_MS);
        if (Math.abs(this._velocityY) < MIN_VELOCITY) this._velocityY = 0;
      }
    }

    if (this._scrollY !== this._lastAppliedY) {
      window.scrollTo(0, this._scrollY);
      this._lastAppliedY = this._scrollY;
    }
  }

  /** autoStart: true のときの自前 rAF ループ。 */
  private tick = (now: number = performance.now()): void => {
    if (this._destroyed) return;
    this.step(now);
    this._rafId = requestAnimationFrame(this.tick);
  };

  /**
   * 外部の rAF ループから 1 フレーム進める（管理モード用）。
   *
   * `autoStart: false` で構築し、`WebGLApp` 等の **単一** rAF ループ内で毎フレーム呼ぶことで、
   * `scrollTo`（このメソッド）→ `scroll 読み取り` の順序を呼び出し側が決定論的に固定できる。
   * これにより 2 つの独立 rAF ループの登録順依存（背景が 1 フレームずれる問題）を排除する。
   *
   * `autoStart: true`（自前ループ稼働中）のときは二重進行を避けるため no-op。
   */
  advance(now: number = performance.now()): void {
    if (this._autoStart) return;
    this.step(now);
  }

  /** 現在の virtual scrollY。 */
  get scrollY(): number {
    return this._scrollY;
  }

  /**
   * 入力受付の有効/無効。
   *
   * disable 中は wheel/touch ハンドラが **preventDefault する前に** early-return するため、
   * native スクロールが復活する（virtual scroll を一時停止して通常スクロールに戻したい
   * ケース用）。accumulator (`_scrollY`) も更新されず、慣性も止まる。
   *
   * 再 enable 時は `_scrollY` / `_lastAppliedY` を現在の `window.scrollY` に再同期して
   * disable 中の native scroll とのズレを吸収する（同期しないと次の wheel/touch 入力で
   * 古い `_scrollY` からの delta になり巨大ジャンプする）。
   */
  set enabled(value: boolean) {
    const wasDisabled = !this._enabled;
    this._enabled = value;
    if (!value) {
      // disable に切り替わったタイミングで慣性も停止
      this._velocityY = 0;
      this._isTouching = false;
    }
    if (value && wasDisabled) {
      this._scrollY = window.scrollY;
      this._lastAppliedY = this._scrollY;
    }
  }

  get enabled(): boolean {
    return this._enabled;
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    cancelAnimationFrame(this._rafId);
    this._eventAbort.abort();
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
  }
}
