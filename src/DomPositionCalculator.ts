import type { DOMPositionInfo } from "./types";

/**
 * DOM要素の位置計算を担当するユーティリティクラス
 */
export class DomPositionCalculator {
  private element: HTMLElement;
  private canvasRect: DOMRect;
  private positionInfo: DOMPositionInfo;
  rect: DOMRect;
  // calculateWebGLPosition の戻り値を使い回すバッファ（GC削減）
  private readonly _outPosition = { x: 0, y: 0 };

  constructor(element: HTMLElement, canvasRect: DOMRect) {
    this.element = element;
    this.canvasRect = canvasRect;
    this.rect = new DOMRect();
    this.positionInfo = {
      pageTop: 0,
      pageLeft: 0,
      isFixed: false,
    };
    // constructor では `getBoundingClientRect` 1 回だけに留め、`getComputedStyle`
    // (refreshPositionType) は呼ばない。両方呼ぶと layout 強制が 2 回走り、
    // 多数 plane / object 構築時の reflow 累積コストが大きくなる。
    // 位置タイプ判定は利用側 (DomPlane の init→resize / Dom3DObject の setupModel)
    // で初期化される。
    this.updatePositionInfo(window.scrollX, window.scrollY);
  }

  /**
   * DOM要素の位置情報を更新（毎フレーム呼ばれる）。
   * scroll 値は Core が rAF tick で確定した 1 組（ScrollSync 有効時は effectiveScrollY）を
   * 引数で受け取る。window 直読みは行わない（scene 座標算出と同一スクロール源にするため）。
   */
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

  /**
   * position: fixed または sticky かどうかを再チェック（初期化・リサイズ時のみ呼ぶ）。
   * fixed / sticky 要素は document 上で位置が固定されないため、毎フレーム rect.top を
   * viewport 座標として扱う isFixed branch を使う。
   */
  refreshPositionType(): void {
    const position = window.getComputedStyle(this.element).position;
    this.positionInfo.isFixed = position === "fixed" || position === "sticky";
  }

  /**
   * WebGL座標系での位置を計算。
   * 戻り値は内部バッファを使い回すため、保持する場合は呼び出し側でコピーすること。
   */
  calculateWebGLPosition(
    scrollX: number = 0,
    scrollY: number = 0,
  ): { x: number; y: number } {
    let canvasCenterX: number;
    let canvasCenterY: number;

    if (this.positionInfo.isFixed) {
      // position: fixed の場合、スクロール位置を考慮しない
      canvasCenterX = this.canvasRect.left + this.canvasRect.width / 2;
      canvasCenterY = this.canvasRect.top + this.canvasRect.height / 2;
    } else {
      // 通常の場合、スクロール位置を考慮する
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

  /**
   * Canvas矩形を更新
   */
  setCanvasRect(canvasRect: DOMRect): void {
    this.canvasRect = canvasRect;
  }

  /**
   * position: fixedかどうか
   */
  get isFixed(): boolean {
    return this.positionInfo.isFixed;
  }

  /**
   * ページトップ位置
   */
  get pageTop(): number {
    return this.positionInfo.pageTop;
  }

  /**
   * ページレフト位置
   */
  get pageLeft(): number {
    return this.positionInfo.pageLeft;
  }
}
