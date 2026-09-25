import type { DOMPositionInfo } from "./types";

export class DomPositionCalculator {
  private element: HTMLElement;
  private canvasRect: DOMRect;
  private positionInfo: DOMPositionInfo;
  rect: DOMRect;
  private readonly _outPosition = { x: 0, y: 0 };
  private _isSticky: boolean = false;
  // canvas（canvasRect）が viewport に固定されているか。
  // - true（既定）: translate モード / fixed 相当の container。canvasRect は viewport 相対の
  //   スナップショットで、page 座標へは現在の scroll を加算して求める。
  // - false: attach:'dom' + 通常フロー container。canvas はページに固定され画面上を流れる。
  //   canvasRect は既に page 座標で渡されるため、scroll を加算してはならない
  //   （加算すると計測時からのスクロール差分ぶん plane がドリフトする）。
  private _canvasViewportFixed: boolean = true;

  constructor(
    element: HTMLElement,
    canvasRect: DOMRect,
    scrollX: number,
    scrollY: number,
    canvasViewportFixed: boolean = true,
  ) {
    this.element = element;
    this.canvasRect = canvasRect;
    this._canvasViewportFixed = canvasViewportFixed;
    this.rect = new DOMRect();
    this.positionInfo = {
      pageTop: 0,
      pageLeft: 0,
      isFixed: false,
    };
    this.updatePositionInfo(scrollX, scrollY);
  }

  updatePositionInfo(scrollX: number, scrollY: number): void {
    this.rect = this.element.getBoundingClientRect();

    if (this.positionInfo.isFixed) {
      this.positionInfo.pageTop = this.rect.top;
      this.positionInfo.pageLeft = this.rect.left;
    } else {
      this.positionInfo.pageTop = this.rect.top + scrollY;
      this.positionInfo.pageLeft = this.rect.left + scrollX;
    }
  }

  refreshPositionType(): void {
    const position = window.getComputedStyle(this.element).position;
    // sticky は「stick する前は通常フロー、stick 後は viewport 固定」と状態が
    // スクロール位置そのものに依存するため、fixed 用の（毎フレーム rect を読み直さない）
    // キャッシュ経路には乗せられない。isFixed は立てず、呼び出し側で毎フレーム
    // updatePositionInfo() を強制させるためだけに isSticky を独立して持つ。
    this.positionInfo.isFixed = position === "fixed";
    this._isSticky = position === "sticky";
  }

  calculateWebGLPosition(
    scrollX: number,
    scrollY: number,
  ): { x: number; y: number } {
    let canvasCenterX: number;
    let canvasCenterY: number;

    if (this.positionInfo.isFixed || !this._canvasViewportFixed) {
      // isFixed 要素: pageTop/pageLeft は viewport 相対の rect 値そのもの。
      // canvasViewportFixed=false（dom + 通常フロー）: canvasRect は既に page 座標なので
      //   scroll を足さない。要素側の pageTop（= rect.top + scrollY, page 座標）と同じ空間で
      //   引き算するため、両者とも scroll を二重加算しないこの分岐で整合する。
      canvasCenterX = this.canvasRect.left + this.canvasRect.width / 2;
      canvasCenterY = this.canvasRect.top + this.canvasRect.height / 2;
    } else {

      canvasCenterX =
        this.canvasRect.left + scrollX + this.canvasRect.width / 2;
      canvasCenterY =
        this.canvasRect.top + scrollY + this.canvasRect.height / 2;
    }

    this._outPosition.x =
      this.positionInfo.pageLeft + this.rect.width / 2 - canvasCenterX;
    this._outPosition.y = -(
      this.positionInfo.pageTop +
      this.rect.height / 2 -
      canvasCenterY
    );

    return this._outPosition;
  }

  setCanvasRect(canvasRect: DOMRect): void {
    this.canvasRect = canvasRect;
  }

  get isFixed(): boolean {
    return this.positionInfo.isFixed;
  }

  get isSticky(): boolean {
    return this._isSticky;
  }

  get pageTop(): number {
    return this.positionInfo.pageTop;
  }

  get pageLeft(): number {
    return this.positionInfo.pageLeft;
  }
}
