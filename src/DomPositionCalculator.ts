import type { DOMPositionInfo } from "./types";

export class DomPositionCalculator {
  private element: HTMLElement;
  private canvasRect: DOMRect;
  private positionInfo: DOMPositionInfo;
  rect: DOMRect;
  private readonly _outPosition = { x: 0, y: 0 };

  constructor(
    element: HTMLElement,
    canvasRect: DOMRect,
    scrollX: number,
    scrollY: number,
  ) {
    this.element = element;
    this.canvasRect = canvasRect;
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
    this.positionInfo.isFixed = position === "fixed" || position === "sticky";
  }

  calculateWebGLPosition(
    scrollX: number,
    scrollY: number,
  ): { x: number; y: number } {
    let canvasCenterX: number;
    let canvasCenterY: number;

    if (this.positionInfo.isFixed) {

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

  get pageTop(): number {
    return this.positionInfo.pageTop;
  }

  get pageLeft(): number {
    return this.positionInfo.pageLeft;
  }
}
