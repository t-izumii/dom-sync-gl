export interface ScrollSyncOptions {
  trackStrength?: boolean;
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
  private _lastAppliedX: number = NaN;
  private _lastAppliedY: number = NaN;

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

    this.container.style.overflow = 'hidden';

    this.container.style.pointerEvents = 'none';
    this.container.style.willChange = 'transform';
  }

  updateSize(wrapperWidth?: number, wrapperHeight?: number): void {
    const docEl = document.documentElement;
    this._viewportWidth = wrapperWidth ?? docEl.clientWidth;
    this._viewportHeight = wrapperHeight ?? docEl.clientHeight;

    this.container.style.width = `${this._viewportWidth}px`;
    this.container.style.height = `${this._viewportHeight}px`;

    this._logicalRect = new DOMRect(
      0,
      0,
      this._viewportWidth,
      this._viewportHeight,
    );

    this.applyTransform(window.scrollX, ScrollSync.computeEffectiveScrollY());
  }

  update(scrollX: number, scrollY: number): void {
    if (!this._enabled) return;
    this.applyTransform(scrollX, scrollY);
    if (this._trackStrength) {
      this.updateStrength(scrollY);
    }
  }

  private applyTransform(scrollX: number, scrollY: number): void {

    if (scrollX === this._lastAppliedX && scrollY === this._lastAppliedY) return;
    this._lastAppliedX = scrollX;
    this._lastAppliedY = scrollY;
    this.container.style.transform =
      `translate3d(${scrollX}px, ${scrollY}px, 0)`;
  }

  static computeEffectiveScrollY(): number {
    return -document.documentElement.getBoundingClientRect().top;
  }

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
