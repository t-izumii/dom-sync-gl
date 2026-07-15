export interface ScrollSyncOptions {
  trackStrength?: boolean;
  strengthDecay?: number;
  overscan?: number | 'auto' | false;
  attach?: 'translate' | 'fixed';
}

export class ScrollSync {
  private container: HTMLElement;
  private _trackStrength: boolean;
  private _strengthDecay: number;
  private _overscan: number;
  private _attach: 'translate' | 'fixed';
  private _strength: number = 0;
  private _prevScrollY: number = 0;
  private _prevTime: number = 0;
  private _viewportWidth: number = 0;
  private _viewportHeight: number = 0;
  private _enabled: boolean = true;
  private _lastAppliedX: number = NaN;
  private _lastAppliedY: number = NaN;
  private _lastRawX: number = NaN;
  private _lastRawY: number = NaN;

  private _logicalRect: DOMRect = new DOMRect();

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
    this._attach = options.attach ?? 'translate';
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

    const vh = ScrollSync._measureViewportHeight();
    this._overscan = ScrollSync._resolveOverscan(options.overscan, vh);

    this.applyContainerStyles();
    this.updateSize();
  }

  private static _measureViewportHeight(): number {
    const docEl = document.documentElement;
    const probe = document.createElement('div');
    probe.style.height = '100lvh';
    document.body.appendChild(probe);
    const lvh = probe.offsetHeight;
    probe.remove();
    return Math.max(lvh, docEl.clientHeight, window.innerHeight);
  }

  private static _resolveOverscan(
    raw: number | 'auto' | false | undefined,
    vh: number,
  ): number {
    if (raw === false || raw == null) return 0;
    if (raw === 'auto') {
      if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) {
        return Math.round(vh * 0.25);
      }
      return 0;
    }
    return Math.max(0, raw);
  }

  private applyContainerStyles(): void {
    this.container.style.position = this._attach === 'fixed' ? 'fixed' : 'absolute';
    this.container.style.left = '0';
    this.container.style.overflow = 'hidden';
    this.container.style.pointerEvents = 'none';
    this.container.style.willChange = 'transform';
  }

  updateSize(wrapperWidth?: number, wrapperHeight?: number): void {
    const docEl = document.documentElement;
    this._viewportWidth = wrapperWidth ?? docEl.clientWidth;

    if (wrapperHeight != null) {
      this._viewportHeight = wrapperHeight;
    } else {
      this._viewportHeight = ScrollSync._measureViewportHeight();
    }

    this.container.style.width = `${this._viewportWidth}px`;
    this.container.style.top = `${this._overscan === 0 ? 0 : -this._overscan}px`;
    this.container.style.height = `${this._viewportHeight + 2 * this._overscan}px`;

    this._logicalRect = new DOMRect(
      0,
      this._overscan === 0 ? 0 : -this._overscan,
      this._viewportWidth,
      this._viewportHeight + 2 * this._overscan,
    );

    if (this._attach !== 'fixed') {
      // レイアウトが変わった可能性があるため、直前と同じスクロール位置でも
      // applyTransform 側の早期returnをスキップさせて再計算を強制する。
      this._lastRawX = NaN;
      this._lastRawY = NaN;
      this.applyTransform(window.scrollX, ScrollSync.computeEffectiveScrollY());
    }
  }

  update(scrollX: number, scrollY: number): void {
    if (!this._enabled) return;
    this.applyTransform(scrollX, scrollY);
    if (this._trackStrength) {
      this.updateStrength(scrollY);
    }
  }

  private applyTransform(scrollX: number, scrollY: number): void {
    if (this._attach === 'fixed') return;

    // scrollX/scrollY が前回と同じなら、offsetHeight 読み取り（強制レイアウト）
    // を含む以降の処理を丸ごとスキップする。updateSize() 呼び出し時はレイアウトが
    // 変わっている可能性があるため、そちらで _lastRawX/_lastRawY を無効化している。
    if (scrollX === this._lastRawX && scrollY === this._lastRawY) return;
    this._lastRawX = scrollX;
    this._lastRawY = scrollY;

    let effectiveY = scrollY;

    if (scrollY > 0) {
      const parent = this.container.offsetParent as HTMLElement | null;
      if (parent) {
        const maxY = parent.offsetHeight - this._viewportHeight - this._overscan;
        if (maxY > 0 && scrollY > maxY) {
          effectiveY = maxY;
        }
      }
    }

    if (scrollX === this._lastAppliedX && effectiveY === this._lastAppliedY) return;
    this._lastAppliedX = scrollX;
    this._lastAppliedY = effectiveY;
    this.container.style.transform =
      `translate3d(${scrollX}px, ${effectiveY}px, 0)`;
  }

  static computeEffectiveScrollY(): number {
    return -document.documentElement.getBoundingClientRect().top;
  }

  private updateStrength(scrollY: number): void {
    const scrollDelta = scrollY - this._prevScrollY;
    const now = performance.now() / 1000;
    const dt = now - this._prevTime;

    if (dt > 0) {
      // _viewportHeight が 0（未計測・レイアウト崩壊時）だと 0/0 = NaN になり、
      // 以後 _strength が減衰でも回復しない NaN 汚染を起こすため 0 にフォールバックする。
      const targetStrength =
        this._viewportHeight > 0
          ? (Math.abs(scrollDelta) * 10) / this._viewportHeight
          : 0;
      this._strength *= Math.exp(-dt * this._strengthDecay);
      this._strength += Math.min(targetStrength, 5);
    }

    this._prevScrollY = scrollY;
    this._prevTime = now;
  }

  get logicalRect(): DOMRect {
    return this._logicalRect;
  }

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
