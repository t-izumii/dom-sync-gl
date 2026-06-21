export interface RafScrollOptions {
  lineHeight?: number;
  touchFriction?: number;
  autoStart?: boolean;
}

const MIN_VELOCITY = 0.01;
const VELOCITY_CUTOFF_MS = 50;
const VELOCITY_EMA_ALPHA = 0.3;
const FRAME_MS = 1000 / 60;
const SELF_SCROLL_EPS = 2;

export class RafScroll {
  private _scrollY: number;

  private _lastAppliedY: number;
  private _maxScroll: number;
  private _rafId: number = 0;
  private _enabled: boolean = true;
  private _lineHeight: number;
  private _friction: number;

  private _autoStart: boolean;
  private _touchPrevY: number = 0;
  private _touchPrevTime: number = 0;

  private _velocityY: number = 0;
  private _isTouching: boolean = false;

  private _allowNativePull: boolean = false;

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

    window.addEventListener('wheel', this.onWheel, {
      passive: false,
      signal,
    });

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

    window.addEventListener('resize', this.onResize, { signal });

    window.addEventListener('scroll', this.onExternalScroll, {
      passive: true,
      signal,
    });
  }

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

    this._velocityY = 0;
    let delta = e.deltaY;

    if (e.deltaMode === 1) delta *= this._lineHeight;
    else if (e.deltaMode === 2) delta *= window.innerHeight;
    this._scrollY = this.clamp(this._scrollY + delta);
  };

  private onTouchStart = (e: TouchEvent): void => {
    if (!this._enabled) return;
    if (e.touches.length === 0) return;

    this._velocityY = 0;
    this._isTouching = true;
    this._touchPrevY = e.touches[0].clientY;
    this._touchPrevTime = performance.now();

    this._allowNativePull = this._scrollY <= 0;
  };

  private onTouchMove = (e: TouchEvent): void => {
    if (!this._enabled) return;
    if (e.touches.length === 0) return;

    const y = e.touches[0].clientY;
    const now = performance.now();
    const dy = this._touchPrevY - y;
    const dt = now - this._touchPrevTime;

    if (this._allowNativePull && dy <= 0) {
      this._touchPrevY = y;
      this._touchPrevTime = now;
      return;
    }

    this._allowNativePull = false;

    e.preventDefault();

    this._scrollY = this.clamp(this._scrollY + dy);

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

    if (performance.now() - this._touchPrevTime > VELOCITY_CUTOFF_MS) {
      this._velocityY = 0;
    }
  };

  private onResize = (): void => {
    this._maxScroll = this.calcMaxScroll();
    this._scrollY = this.clamp(this._scrollY);
  };

  private onExternalScroll = (): void => {
    if (this._destroyed || !this._enabled || this._isTouching) return;
    const y = window.scrollY;

    if (Math.abs(y - this._lastAppliedY) <= SELF_SCROLL_EPS) return;

    this._scrollY = this.clamp(y);
    this._lastAppliedY = this._scrollY;
    this._velocityY = 0;
  };

  private clamp(y: number): number {
    return Math.min(this._maxScroll, Math.max(0, y));
  }

  private step(now: number): void {
    if (this._destroyed) return;

    const dt = this._lastTickTime === 0 ? FRAME_MS : now - this._lastTickTime;
    this._lastTickTime = now;

    if (!this._isTouching && Math.abs(this._velocityY) > MIN_VELOCITY) {
      const before = this._scrollY;
      const next = this.clamp(this._scrollY + this._velocityY * dt);
      this._scrollY = next;

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

  private tick = (now: number = performance.now()): void => {
    if (this._destroyed) return;
    this.step(now);
    this._rafId = requestAnimationFrame(this.tick);
  };

  advance(now: number = performance.now()): void {
    if (this._autoStart) return;
    this.step(now);
  }

  get scrollY(): number {
    return this._scrollY;
  }

  set enabled(value: boolean) {
    const wasDisabled = !this._enabled;
    this._enabled = value;
    if (!value) {

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
