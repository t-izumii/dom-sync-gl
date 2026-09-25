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
    const calc = new DomPositionCalculator(el, canvasRect, 0, 0);

    const pos = calc.calculateWebGLPosition(0, 0);
    expect(pos.x).toBeCloseTo(0);
    expect(pos.y).toBeCloseTo(0);
  });

  it('canvas 中央より上の要素は Y がプラス（Y軸反転）', () => {
    const el = makeElement({ top: 100, left: 400, width: 200, height: 200 });
    const canvasRect = new DOMRect(0, 0, 1000, 1000);
    const calc = new DomPositionCalculator(el, canvasRect, 0, 0);

    const pos = calc.calculateWebGLPosition(0, 0);
    // 要素中心 Y = 200, canvas 中心 Y = 500, 差 = -300 → 反転 → 300
    expect(pos.y).toBe(300);
  });

  it('isFixed=false の要素は scrollY を考慮する', () => {
    const el = makeElement({ top: 100, left: 100, width: 100, height: 100 });
    const canvasRect = new DOMRect(0, 0, 1000, 1000);
    const calc = new DomPositionCalculator(el, canvasRect, 0, 0);

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
    const calc = new DomPositionCalculator(el, canvasRect, 0, 0);
    // constructor では getComputedStyle (refreshPositionType) を呼ばない仕様に変更
    // されたため、明示的に呼ぶ
    calc.refreshPositionType();
    calc.updatePositionInfo(0, 0);

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

    const calc = new DomPositionCalculator(el, new DOMRect(0, 0, 1000, 1000), 0, 0);
    // constructor で getComputedStyle を呼ばない仕様のため明示的に
    calc.refreshPositionType();
    expect(calc.isFixed).toBe(true);
  });

  describe('position: sticky', () => {
    it('refreshPositionType は sticky を isFixed とみなさない（回帰）', () => {
      // Given: position: sticky の要素
      const el = makeElement({ top: 0, left: 0, width: 10, height: 10 });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        position: 'sticky',
      } as CSSStyleDeclaration);
      const calc = new DomPositionCalculator(el, new DOMRect(0, 0, 1000, 1000), 0, 0);

      // When: 型判定を更新する
      calc.refreshPositionType();

      // Then: fixed 用の（スクロールを無視する）経路には乗らず、isSticky で個別に判別できる
      expect(calc.isFixed).toBe(false);
      expect(calc.isSticky).toBe(true);
    });

    it('sticky（stick する前 = 通常フロー）は isFixed=false と同じ式で scrollY を考慮する', () => {
      // Given: stick する前の sticky 要素（rect は通常要素と同様、スクロールに追従して動く）
      const el = makeElement({ top: 100, left: 100, width: 100, height: 100 });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        position: 'sticky',
      } as CSSStyleDeclaration);
      const canvasRect = new DOMRect(0, 0, 1000, 1000);
      const calc = new DomPositionCalculator(el, canvasRect, 0, 0);
      calc.refreshPositionType();
      calc.updatePositionInfo(0, 0);

      // When: 追加スクロール分だけ rect.top が同じ量だけ減る（通常フロー中の実際の挙動）
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        top: -100,
        left: 100,
        right: 200,
        bottom: 0,
        width: 100,
        height: 100,
        x: 100,
        y: -100,
        toJSON: () => ({}),
      } as DOMRect);
      calc.updatePositionInfo(0, 200);
      const pos = calc.calculateWebGLPosition(0, 200);

      // Then: fixed 用の式（scrollY 無視）ではなく通常要素と同じ式（scrollY 加算）で計算される。
      // rect.top が scrollY と同量だけ減っている（= 通常フロー中の実際の挙動）ため、
      // pageTop は不変（100）になり、既存の「isFixed=false, scrollY=200」テスト
      // （57行目）と同じ入力から同じ結果 550 になる。
      expect(pos.y).toBe(550);
    });

    it('sticky（stick 中 = viewport 固定）は rect が変化しなくても画面上の位置が不変', () => {
      // Given: stick して viewport に固定された sticky 要素（rect.top はスクロールしても変化しない）
      const el = makeElement({ top: 20, left: 100, width: 100, height: 100 });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        position: 'sticky',
      } as CSSStyleDeclaration);
      const canvasRect = new DOMRect(0, 0, 1000, 1000);
      const calc = new DomPositionCalculator(el, canvasRect, 0, 0);
      calc.refreshPositionType();
      calc.updatePositionInfo(0, 0);
      const before = { ...calc.calculateWebGLPosition(0, 0) };

      // When: スクロールが進んでも rect は同じ（stick 中なので viewport 上動かない）
      calc.updatePositionInfo(0, 300);
      const after = calc.calculateWebGLPosition(0, 300);

      // Then: 毎フレーム rect を読み直す限り、stick 中は画面上の位置が変わらない
      expect(after.y).toBeCloseTo(before.y);
      expect(after.x).toBeCloseTo(before.x);
    });
  });

  // 'dom' モード + 通常フロー container + DOM ロック plane + スクロールのドリフト回帰。
  // canvasViewportFixed=false のとき canvasRect は page 座標で渡され、位置式は scroll を
  // 加算してはならない。加算していた旧実装ではスクロール差分ぶん plane がドリフトしていた。
  describe("attach:'dom' + 通常フロー canvas (canvasViewportFixed=false)", () => {
    it('canvas も要素も同量スクロールしても WebGL 位置は不変（ドリフトしない）', () => {
      // Given: page 座標で渡される canvasRect（通常フロー container を page 化したもの）と、
      // その中央に置かれた通常フロー要素。
      const el = makeElement({ top: 400, left: 400, width: 200, height: 200 });
      // canvasRect は page 座標（left/top は計測時 scroll を足した固定値）。
      const canvasRect = new DOMRect(0, 400, 1000, 1000);
      const calc = new DomPositionCalculator(el, canvasRect, 0, 0, false);

      // 要素中心 = (500, 500) page 座標、canvas 中心 = (500, 900) page 座標
      const before = { ...calc.calculateWebGLPosition(0, 0) };

      // When: 200 スクロール。通常フローなので要素の viewport rect.top は 200 減るが、
      // page 座標（pageTop = rect.top + scrollY）は不変。canvasRect も page 座標なので不変。
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        top: 200,
        left: 400,
        right: 600,
        bottom: 400,
        width: 200,
        height: 200,
        x: 400,
        y: 200,
        toJSON: () => ({}),
      } as DOMRect);
      calc.updatePositionInfo(0, 200);
      const after = calc.calculateWebGLPosition(0, 200);

      // Then: canvas と要素が同じページに固定されているので、スクロールしても相対位置は不変。
      expect(after.x).toBeCloseTo(before.x);
      expect(after.y).toBeCloseTo(before.y);
    });

    it('canvasViewportFixed=true（既定）だと同じ入力でスクロール差分ぶんドリフトする（対比）', () => {
      // 旧来の viewport 固定 canvas 想定。canvasRect に scroll を加算するため、
      // page 座標の canvasRect をそのまま渡すと二重加算になりドリフトが出る。
      const el = makeElement({ top: 400, left: 400, width: 200, height: 200 });
      const canvasRect = new DOMRect(0, 400, 1000, 1000);
      const calc = new DomPositionCalculator(el, canvasRect, 0, 0, true);

      const before = { ...calc.calculateWebGLPosition(0, 0) };

      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        top: 200,
        left: 400,
        right: 600,
        bottom: 400,
        width: 200,
        height: 200,
        x: 400,
        y: 200,
        toJSON: () => ({}),
      } as DOMRect);
      calc.updatePositionInfo(0, 200);
      const after = calc.calculateWebGLPosition(0, 200);

      // canvasCenterY に scrollY(200) が加算されるためドリフトする（不整合を可視化する対比）。
      expect(after.y).not.toBeCloseTo(before.y);
    });
  });

  it('setCanvasRect で canvasRect を差し替えると結果が変わる', () => {
    const el = makeElement({ top: 0, left: 0, width: 100, height: 100 });
    const calc = new DomPositionCalculator(el, new DOMRect(0, 0, 1000, 1000), 0, 0);
    const pos1 = { ...calc.calculateWebGLPosition(0, 0) };

    calc.setCanvasRect(new DOMRect(100, 100, 1000, 1000));
    const pos2 = { ...calc.calculateWebGLPosition(0, 0) };

    expect(pos1.x).not.toBe(pos2.x);
    expect(pos1.y).not.toBe(pos2.y);
  });

  it('updatePositionInfo で要素位置の変化を取り込む', () => {
    const el = makeElement({ top: 0, left: 0, width: 100, height: 100 });
    const calc = new DomPositionCalculator(el, new DOMRect(0, 0, 1000, 1000), 0, 0);
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

    calc.updatePositionInfo(0, 0);
    const after = { ...calc.calculateWebGLPosition(0, 0) };

    expect(after.x).not.toBe(before.x);
    expect(after.y).not.toBe(before.y);
  });

  // 単発イベント経路（ctor / resize / setup）のスクロール源を Core 確定値（キャッシュ）に
  // 一本化したことの直接の回帰テスト。ctor が window.scrollX/Y を直読みせず、引数で受けた
  // 確定スクロール値で初期 pageTop/pageLeft を算出することを検証する。
  describe('constructor の scroll 引数（キャッシュ源一本化）', () => {
    it('isFixed=false: 初期 pageTop/pageLeft は引数 scroll を反映する', () => {
      // Given: canvas 中央付近の非 fixed 要素
      const el = makeElement({ top: 100, left: 50, width: 100, height: 100 });

      // When: Core キャッシュの確定 scroll 値（scrollX=200, scrollY=300）を ctor に渡す
      const calc = new DomPositionCalculator(
        el,
        new DOMRect(0, 0, 1000, 1000),
        200,
        300,
      );

      // Then: pageTop = rect.top(100) + scrollY(300), pageLeft = rect.left(50) + scrollX(200)
      expect(calc.pageTop).toBe(400);
      expect(calc.pageLeft).toBe(250);
    });

    it('引数 scroll が window.scrollX/Y と乖離しても初期値は引数に従う（window 直読み排除）', () => {
      // Given: window.scroll* を Core 確定値とは別の値に固定（直読みしていれば混入する）
      const el = makeElement({ top: 100, left: 50, width: 100, height: 100 });
      Object.defineProperty(window, 'scrollX', {
        value: 8888,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, 'scrollY', {
        value: 9999,
        writable: true,
        configurable: true,
      });

      // When: Core キャッシュの確定値（200, 300）を ctor に渡す
      const calc = new DomPositionCalculator(
        el,
        new DOMRect(0, 0, 1000, 1000),
        200,
        300,
      );

      // Then: window.scroll*（8888/9999）ではなく引数（200/300）が使われる
      expect(calc.pageTop).toBe(400);
      expect(calc.pageLeft).toBe(250);
    });
  });

  // S-1: scroll スナップショット不変条件が updateRectEveryFrame 経路で破れる問題の回帰テスト。
  // updatePositionInfo(scrollX, scrollY) を必須引数化し、window.scrollX/Y 直読みを排除する。
  // rect 算出のスクロール源と座標変換のスクロール源を Core 確定値で一致させる。
  describe('updatePositionInfo の scroll 引数 (S-1 回帰)', () => {
    it('isFixed=false: pageTop/pageLeft は引数 scroll を反映する', () => {
      // Given: canvas 中央付近に置かれた非 fixed 要素
      const el = makeElement({ top: 100, left: 50, width: 100, height: 100 });
      const calc = new DomPositionCalculator(el, new DOMRect(0, 0, 1000, 1000), 0, 0);

      // When: Core が確定した scroll 値を引数で渡す（scrollX=200, scrollY=300）
      calc.updatePositionInfo(200, 300);

      // Then: pageTop = rect.top(100) + scrollY(300), pageLeft = rect.left(50) + scrollX(200)
      expect(calc.pageTop).toBe(400);
      expect(calc.pageLeft).toBe(250);
    });

    it('引数 scroll が window.scrollX/Y と乖離しても pageTop/pageLeft は引数に従う（rubber-band 相当）', () => {
      // Given: iOS rubber-band 中を模し window.scroll* を引数とは別の値に固定
      const el = makeElement({ top: 100, left: 50, width: 100, height: 100 });
      const calc = new DomPositionCalculator(el, new DOMRect(0, 0, 1000, 1000), 0, 0);
      Object.defineProperty(window, 'scrollX', {
        value: 8888,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, 'scrollY', {
        value: 9999,
        writable: true,
        configurable: true,
      });

      // When: Core 確定の effectiveScroll（200, 300）を引数で渡す
      calc.updatePositionInfo(200, 300);

      // Then: window.scroll*（8888/9999）ではなく引数（200/300）が使われる
      expect(calc.pageTop).toBe(400);
      expect(calc.pageLeft).toBe(250);
    });

    it('isFixed=true: 引数 scroll を無視して rect 値をそのまま使う', () => {
      // Given: position: fixed 要素
      const el = makeElement({ top: 100, left: 50, width: 100, height: 100 });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        position: 'fixed',
      } as CSSStyleDeclaration);
      const calc = new DomPositionCalculator(el, new DOMRect(0, 0, 1000, 1000), 0, 0);
      calc.refreshPositionType();

      // When: 引数 scroll を渡しても
      calc.updatePositionInfo(200, 300);

      // Then: fixed 分岐は引数を参照せず rect.top/left をそのまま使う
      expect(calc.pageTop).toBe(100);
      expect(calc.pageLeft).toBe(50);
    });

    it('updateRectEveryFrame 経路: WebGL 位置は window.scrollY ではなく引数 scroll に従う', () => {
      // Given: rubber-band 中で window.scrollY が effectiveScrollY と乖離
      const el = makeElement({ top: 100, left: 100, width: 100, height: 100 });
      const calc = new DomPositionCalculator(el, new DOMRect(0, 0, 1000, 1000), 0, 0);
      Object.defineProperty(window, 'scrollY', {
        value: 9999,
        writable: true,
        configurable: true,
      });

      // When: Core 確定の effectiveScrollY(200) を rect 算出と座標算出の両方に同値で渡す
      calc.updatePositionInfo(0, 200);
      const pos = calc.calculateWebGLPosition(0, 200);

      // Then: window.scrollY(9999) に依存せず一貫した位置になる
      // pageTop = 100 + 200 = 300, 要素中心 Y = 350
      // canvasCenterY = 0 + 200 + 500 = 700, y = -(350 - 700) = 350
      expect(pos.y).toBe(350);
    });
  });
});
