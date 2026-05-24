import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DomPositionCalculator } from '../DomPositionCalculator';

function makeElement(rect: {
  top?: number;
  left?: number;
  width?: number;
  height?: number;
}): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const top = rect.top ?? 0;
  const left = rect.left ?? 0;
  const width = rect.width ?? 0;
  const height = rect.height ?? 0;
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
  return el;
}

describe('DomPositionCalculator', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(window, 'scrollX', { value: 0, writable: true, configurable: true });
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
  });

  it('canvas 中央に置かれた要素のWebGL位置は (0, 0)', () => {
    const el = makeElement({ top: 400, left: 400, width: 200, height: 200 });
    const canvasRect = new DOMRect(0, 0, 1000, 1000);
    const calc = new DomPositionCalculator(el, canvasRect);

    const pos = calc.calculateWebGLPosition(0, 0);
    expect(pos.x).toBeCloseTo(0);
    expect(pos.y).toBeCloseTo(0);
  });

  it('canvas 中央より上の要素は Y がプラス（Y軸反転）', () => {
    const el = makeElement({ top: 100, left: 400, width: 200, height: 200 });
    const canvasRect = new DOMRect(0, 0, 1000, 1000);
    const calc = new DomPositionCalculator(el, canvasRect);

    const pos = calc.calculateWebGLPosition(0, 0);
    // 要素中心 Y = 200, canvas 中心 Y = 500, 差 = -300 → 反転 → 300
    expect(pos.y).toBe(300);
  });

  it('isFixed=false の要素は scrollY を考慮する', () => {
    const el = makeElement({ top: 100, left: 100, width: 100, height: 100 });
    const canvasRect = new DOMRect(0, 0, 1000, 1000);
    const calc = new DomPositionCalculator(el, canvasRect);

    const pos = calc.calculateWebGLPosition(0, 200);
    // pageTop = 100 (構築時 scrollY=0)
    // 要素中心 Y = 150
    // canvasCenterY = 0 + 200 + 500 = 700
    // y = -(150 - 700) = 550
    expect(pos.y).toBe(550);
  });

  it('isFixed=true (position: fixed) の要素は scrollX / scrollY の引数を無視する', () => {
    const el = makeElement({ top: 100, left: 100, width: 100, height: 100 });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      position: 'fixed',
    } as CSSStyleDeclaration);
    const canvasRect = new DOMRect(0, 0, 1000, 1000);
    const calc = new DomPositionCalculator(el, canvasRect);
    // constructor では getComputedStyle (refreshPositionType) を呼ばない仕様に変更
    // されたため、明示的に呼ぶ
    calc.refreshPositionType();
    calc.updatePositionInfo();

    const pos1 = { ...calc.calculateWebGLPosition(0, 0) };
    const pos2 = { ...calc.calculateWebGLPosition(500, 999) };
    expect(pos1.x).toBe(pos2.x);
    expect(pos1.y).toBe(pos2.y);
  });

  it('refreshPositionType が CSS position: fixed を反映する', () => {
    const el = makeElement({ top: 0, left: 0, width: 10, height: 10 });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      position: 'fixed',
    } as CSSStyleDeclaration);

    const calc = new DomPositionCalculator(el, new DOMRect(0, 0, 1000, 1000));
    // constructor で getComputedStyle を呼ばない仕様のため明示的に
    calc.refreshPositionType();
    expect(calc.isFixed).toBe(true);
  });

  it('setCanvasRect で canvasRect を差し替えると結果が変わる', () => {
    const el = makeElement({ top: 0, left: 0, width: 100, height: 100 });
    const calc = new DomPositionCalculator(el, new DOMRect(0, 0, 1000, 1000));
    const pos1 = { ...calc.calculateWebGLPosition(0, 0) };

    calc.setCanvasRect(new DOMRect(100, 100, 1000, 1000));
    const pos2 = { ...calc.calculateWebGLPosition(0, 0) };

    expect(pos1.x).not.toBe(pos2.x);
    expect(pos1.y).not.toBe(pos2.y);
  });

  it('updatePositionInfo で要素位置の変化を取り込む', () => {
    const el = makeElement({ top: 0, left: 0, width: 100, height: 100 });
    const calc = new DomPositionCalculator(el, new DOMRect(0, 0, 1000, 1000));
    const before = { ...calc.calculateWebGLPosition(0, 0) };

    // 要素位置を移動
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: 200,
      left: 200,
      right: 300,
      bottom: 300,
      width: 100,
      height: 100,
      x: 200,
      y: 200,
      toJSON: () => ({}),
    } as DOMRect);

    calc.updatePositionInfo();
    const after = { ...calc.calculateWebGLPosition(0, 0) };

    expect(after.x).not.toBe(before.x);
    expect(after.y).not.toBe(before.y);
  });
});
