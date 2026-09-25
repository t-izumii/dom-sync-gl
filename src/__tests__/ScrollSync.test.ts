import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScrollSync } from '../ScrollSync';

describe('ScrollSync', () => {
  let container: HTMLElement;
  let mockNow = 0;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    Object.defineProperty(window, 'innerWidth', {
      value: 1000,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      writable: true,
      configurable: true,
    });
    // updateSize は既定で documentElement.clientWidth/clientHeight（スクロールバー除外の
    // 実コンテンツ領域）を読む。横スクロール無限ループ防止のため innerWidth ではなくこちらを使う。
    Object.defineProperty(document.documentElement, 'clientWidth', {
      value: 1000,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, 'clientHeight', {
      value: 800,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'scrollX', {
      value: 0,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'scrollY', {
      value: 0,
      writable: true,
      configurable: true,
    });
    // documentElement.getBoundingClientRect は通常スクロール時 top=-scrollY を返す。
    // ScrollSync.computeEffectiveScrollY が更新後の updateSize で読むので mock しておく。
    vi.spyOn(document.documentElement, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, -window.scrollY, 1000, 3000),
    );

    mockNow = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => mockNow);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('コンストラクタで container を absolute inset:0 + overflow:hidden で document に貼る', () => {
    new ScrollSync(container);
    expect(container.style.position).toBe('absolute');
    expect(container.style.left).toBe('0px');
    expect(container.style.top).toBe('0px');
    expect(container.style.overflow).toBe('hidden');
    expect(container.style.pointerEvents).toBe('none');
    expect(container.style.willChange).toBe('transform');
  });

  it('container 寸法は viewport と一致する (initial)', () => {
    new ScrollSync(container);
    expect(container.style.width).toBe('1000px');
    expect(container.style.height).toBe('800px');
  });

  it('縦スクロールバーぶんを除いた clientWidth を採用する（横スクロール無限ループ防止）', () => {
    // 縦スクロールバーがある状態を模す: innerWidth は scrollbar を含む、clientWidth は含まない。
    // container 幅に innerWidth(1015) を使うと約 15px はみ出して横スクロール→translate 無限拡大する。
    Object.defineProperty(window, 'innerWidth', { value: 1015, configurable: true });
    Object.defineProperty(document.documentElement, 'clientWidth', {
      value: 1000,
      configurable: true,
    });
    new ScrollSync(container);
    expect(container.style.width).toBe('1000px'); // innerWidth(1015) ではなく clientWidth(1000)
  });

  it('logicalRect は viewport そのままの (0, 0, vw, vh) を返す', () => {
    const sync = new ScrollSync(container);
    const rect = sync.logicalRect;
    expect(rect.left).toBe(0);
    expect(rect.top).toBe(0);
    expect(rect.width).toBe(1000);
    expect(rect.height).toBe(800);
  });

  it('updateSize で viewport 幅変更が container サイズと logicalRect に反映される', () => {
    const sync = new ScrollSync(container);
    sync.updateSize(1200, 900);
    expect(container.style.width).toBe('1200px');
    expect(container.style.height).toBe('900px');
    expect(sync.logicalRect.width).toBe(1200);
    expect(sync.logicalRect.height).toBe(900);
  });

  it('update(scrollX, scrollY) で container transform に scroll が反映される', () => {
    const sync = new ScrollSync(container);
    sync.update(0, 400);
    expect(container.style.transform).toBe('translate3d(0px, 400px, 0)');
  });

  it('update に負の scrollY (rubber-band 想定) を渡すと負方向に transform される', () => {
    const sync = new ScrollSync(container);
    // pull-to-refresh で visual_offset=80 のとき effectiveScrollY = -80
    sync.update(0, -80);
    expect(container.style.transform).toBe('translate3d(0px, -80px, 0)');
  });

  it('S-3: scroll 値が変わらないフレームでは transform を再書き込みしない（差分適用）', () => {
    const sync = new ScrollSync(container);

    sync.update(0, 400);
    expect(container.style.transform).toBe('translate3d(0px, 400px, 0)');

    // 外部から sentinel（有効な transform 値）を書き込み、同値 update が上書きしない
    // ＝書き込みスキップを観測する。jsdom は無効な CSS 値を弾くので valid な値を使う。
    container.style.transform = 'translate3d(7px, 7px, 0)';
    sync.update(0, 400);
    sync.update(0, 400);
    expect(container.style.transform).toBe('translate3d(7px, 7px, 0)');

    // scroll 値が変われば再び書き込む
    sync.update(0, 401);
    expect(container.style.transform).toBe('translate3d(0px, 401px, 0)');
  });

  it('computeEffectiveScrollY: 通常スクロール時は window.scrollY と一致する', () => {
    Object.defineProperty(window, 'scrollY', { value: 500, configurable: true });
    expect(ScrollSync.computeEffectiveScrollY()).toBe(500);
  });

  it('computeEffectiveScrollY: rubber-band 中は visual_offset 分マイナスに振れる', () => {
    // iOS 上端 rubber-band: scrollY=0 のままで documentElement.BCR.top が +visual_offset
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    vi.spyOn(document.documentElement, 'getBoundingClientRect').mockReturnValueOnce(
      new DOMRect(0, 80, 1000, 3000), // visual_offset = 80
    );
    expect(ScrollSync.computeEffectiveScrollY()).toBe(-80);
  });

  it('trackStrength=true でスクロール時に strength が増加する', () => {
    const sync = new ScrollSync(container, {
      trackStrength: true,
      strengthDecay: 10,
    });
    expect(sync.strength).toBe(0);

    mockNow = 16;
    sync.update(0, 100);

    expect(sync.strength).toBeGreaterThan(0);
  });

  it('trackStrength=true でスクロール停止後に strength が減衰する', () => {
    const sync = new ScrollSync(container, {
      trackStrength: true,
      strengthDecay: 10,
    });

    mockNow = 16;
    sync.update(0, 500);
    const s1 = sync.strength;
    expect(s1).toBeGreaterThan(0);

    // スクロール停止: scrollY 変化なし + 十分な時間経過
    mockNow = 5000;
    sync.update(0, 500);
    const s2 = sync.strength;
    expect(s2).toBeLessThan(s1);
  });

  it('viewportHeight=0 のとき strength が NaN 汚染されない（0除算の回帰）', () => {
    const sync = new ScrollSync(container, {
      trackStrength: true,
      strengthDecay: 10,
    });
    // レイアウト崩壊等で viewportHeight が 0 になった状態を模す
    sync.updateSize(1000, 0);

    mockNow = 16;
    sync.update(0, 100);

    // 0 除算で NaN になっていれば Number.isFinite は false になる
    expect(Number.isFinite(sync.strength)).toBe(true);
    expect(sync.strength).toBe(0);
  });

  it('update() を長時間挟まないと strength が 1 に張り付く（停止復帰のスパイク再現）', () => {
    const sync = new ScrollSync(container, {
      trackStrength: true,
      strengthDecay: 10,
    });

    // 通常フレーム相当の小さいスクロール（この時点では飽和しない）
    mockNow = 16;
    sync.update(0, 10);
    expect(sync.strength).toBeLessThan(1);

    // 10 秒ぶん update() を呼ばず 5000px スクロールした状態で再開する
    mockNow = 10_016;
    sync.update(0, 5010);

    expect(sync.strength).toBe(1);
  });

  it('resetStrengthBaseline() を挟めば復帰初回の strength が張り付かない', () => {
    const sync = new ScrollSync(container, {
      trackStrength: true,
      strengthDecay: 10,
    });

    mockNow = 16;
    sync.update(0, 10);

    // 上と同じ停止区間。再開直前に前回値を継ぎ直す
    mockNow = 10_016;
    sync.resetStrengthBaseline(5010);

    mockNow = 10_032;
    sync.update(0, 5020);

    expect(sync.strength).toBeLessThan(1);
  });

  it('resetStrengthBaseline() は省略時に実効 scrollY を基準にする', () => {
    const sync = new ScrollSync(container, {
      trackStrength: true,
      strengthDecay: 10,
    });

    mockNow = 16;
    sync.update(0, 10);

    // documentElement.getBoundingClientRect の mock 経由で実効 scrollY = 5010 になる
    (window as unknown as { scrollY: number }).scrollY = 5010;
    mockNow = 10_016;
    sync.resetStrengthBaseline();

    mockNow = 10_032;
    sync.update(0, 5020);

    expect(sync.strength).toBeLessThan(1);
  });

  it('strength: trackStrength=false なら常に 0', () => {
    const sync = new ScrollSync(container, { trackStrength: false });
    mockNow = 16;
    sync.update(0, 500);
    expect(sync.strength).toBe(0);
  });

  it('enabled=false にすると update() が no-op になり transform は disable 直前の値で固定', () => {
    const sync = new ScrollSync(container);
    sync.update(0, 100);
    const frozen = container.style.transform;
    expect(frozen).not.toBe('');

    sync.enabled = false;
    sync.update(0, 500);
    expect(container.style.transform).toBe(frozen);
  });

  it('destroy() で container のスタイルが「ScrollSync 前の inline 値」(空) に復元される', () => {
    const sync = new ScrollSync(container);
    sync.destroy();

    expect(container.style.position).toBe('');
    expect(container.style.left).toBe('');
    expect(container.style.top).toBe('');
    expect(container.style.width).toBe('');
    expect(container.style.height).toBe('');
    expect(container.style.overflow).toBe('');
    expect(container.style.transform).toBe('');
    expect(container.style.pointerEvents).toBe('');
    expect(container.style.willChange).toBe('');
  });

  it('destroy(): ScrollSync 前に当たっていた inline style は復元される', () => {
    container.style.position = 'relative';
    container.style.pointerEvents = 'auto';
    container.style.overflow = 'auto';

    const sync = new ScrollSync(container);
    expect(container.style.position).toBe('absolute');
    expect(container.style.pointerEvents).toBe('none');
    expect(container.style.overflow).toBe('hidden');

    sync.destroy();
    expect(container.style.position).toBe('relative');
    expect(container.style.pointerEvents).toBe('auto');
    expect(container.style.overflow).toBe('auto');
  });

  describe('overscan', () => {
    // jsdom は matchMedia を実装していないので spyOn できない（= 実装側の
    // `typeof window.matchMedia === 'function'` ガードが効いて 0 になる）。
    // ここでは実ブラウザを模して matchMedia 自体を生やす。
    // (pointer: coarse) にマッチするかだけ切り替え、他のクエリは常に false。
    const mockPointer = (coarse: boolean) => {
      Object.defineProperty(window, 'matchMedia', {
        value: (query: string) =>
          ({
            matches: coarse && query === '(pointer: coarse)',
            media: query,
          }) as MediaQueryList,
        writable: true,
        configurable: true,
      });
    };

    afterEach(() => {
      // 他の describe に matchMedia が漏れないよう未実装の状態へ戻す。
      Reflect.deleteProperty(window, 'matchMedia');
    });

    it('matchMedia が無い環境 (SSR / 旧ブラウザ) では auto でも 0 に落ちる', () => {
      expect(window.matchMedia).toBeUndefined();
      new ScrollSync(container, { overscan: 'auto' });
      expect(container.style.top).toBe('0px');
      expect(container.style.height).toBe('800px');
    });

    it('既定 (未指定) は auto 扱いで、coarse pointer では viewportHeight * 0.25 を上下に確保する', () => {
      mockPointer(true);
      new ScrollSync(container);
      // vh=800 → overscan=200。上に -200 ずらし、高さは 800 + 200*2。
      expect(container.style.top).toBe('-200px');
      expect(container.style.height).toBe('1200px');
    });

    it('既定 (未指定) でも fine pointer では 0 になり余白のオーバーヘッドが無い', () => {
      mockPointer(false);
      new ScrollSync(container);
      expect(container.style.top).toBe('0px');
      expect(container.style.height).toBe('800px');
    });

    it("overscan: 'auto' を明示しても既定と同じ挙動になる", () => {
      mockPointer(true);
      new ScrollSync(container, { overscan: 'auto' });
      expect(container.style.top).toBe('-200px');
      expect(container.style.height).toBe('1200px');
    });

    it('overscan: false で coarse pointer でも余白なしにオプトアウトできる', () => {
      mockPointer(true);
      new ScrollSync(container, { overscan: false });
      expect(container.style.top).toBe('0px');
      expect(container.style.height).toBe('800px');
    });

    it('overscan に数値を渡すと pointer の種別に関係なくその px を使う', () => {
      mockPointer(false);
      new ScrollSync(container, { overscan: 50 });
      expect(container.style.top).toBe('-50px');
      expect(container.style.height).toBe('900px');
    });

    it('logicalRect が overscan ぶん広がる', () => {
      mockPointer(true);
      const sync = new ScrollSync(container);
      expect(sync.logicalRect.y).toBe(-200);
      expect(sync.logicalRect.height).toBe(1200);
    });
  });

  describe("attach: 'dom'", () => {
    // jsdom は getBoundingClientRect が 0 を返すので、container の box を mock する。
    const mockBCR = (rect: DOMRect) => {
      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rect);
    };

    it("'dom' モードでは container の position を上書きしない", () => {
      mockBCR(new DOMRect(0, 0, 600, 400));
      container.style.position = 'fixed';

      new ScrollSync(container, { attach: 'dom' });

      // container の CSS 配置をそのまま尊重する（absolute に上書きしない）。
      expect(container.style.position).toBe('fixed');
      // position/サイズ/transform の inline 上書きも行わない。
      expect(container.style.width).toBe('');
      expect(container.style.height).toBe('');
      expect(container.style.top).toBe('');
      expect(container.style.transform).toBe('');
    });

    it('logicalRect が container の getBoundingClientRect を反映する', () => {
      mockBCR(new DOMRect(10, 20, 600, 400));

      const sync = new ScrollSync(container, { attach: 'dom' });

      expect(sync.logicalRect.left).toBe(10);
      expect(sync.logicalRect.top).toBe(20);
      expect(sync.logicalRect.width).toBe(600);
      expect(sync.logicalRect.height).toBe(400);
    });

    it('update() は dom モードで transform を書き込まない (no-op)', () => {
      mockBCR(new DOMRect(0, 0, 600, 400));

      const sync = new ScrollSync(container, { attach: 'dom' });
      sync.update(0, 400);

      expect(container.style.transform).toBe('');
    });

    it('overscan は dom モードで無視される', () => {
      mockBCR(new DOMRect(0, 0, 600, 400));
      Object.defineProperty(window, 'matchMedia', {
        value: (query: string) =>
          ({
            matches: query === '(pointer: coarse)',
            media: query,
          }) as MediaQueryList,
        writable: true,
        configurable: true,
      });

      const sync = new ScrollSync(container, { attach: 'dom', overscan: 'auto' });

      // overscan を確保しない: top/height の上書きは無く、logicalRect も BCR そのまま。
      expect(container.style.top).toBe('');
      expect(container.style.height).toBe('');
      expect(sync.logicalRect.top).toBe(0);
      expect(sync.logicalRect.height).toBe(400);

      Reflect.deleteProperty(window, 'matchMedia');
    });

    it('destroy() が dom モードで container のスタイルを壊さない', () => {
      mockBCR(new DOMRect(0, 0, 600, 400));
      container.style.position = 'fixed';
      container.style.width = '600px';
      container.style.height = '400px';

      const sync = new ScrollSync(container, { attach: 'dom' });
      sync.destroy();

      // ScrollSync は何も変更していないので、事前の inline style がそのまま残る。
      expect(container.style.position).toBe('fixed');
      expect(container.style.width).toBe('600px');
      expect(container.style.height).toBe('400px');
    });

    it('dom モードでは viewport 計測用 probe を body に挿入しない', () => {
      mockBCR(new DOMRect(0, 0, 600, 400));
      const appendSpy = vi.spyOn(document.body, 'appendChild');

      new ScrollSync(container, { attach: 'dom' });

      // _measureViewportHeight() は 100lvh の probe div を body に append する。
      // dom モードではその結果を使わないので一切呼ばれてはならない。
      const appendedProbe = appendSpy.mock.calls.some(
        ([node]) => node instanceof HTMLElement && node.style.height === '100lvh',
      );
      expect(appendedProbe).toBe(false);
    });
  });

  it("translate モードでは viewport 計測用 probe を body に挿入する", () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild');

    new ScrollSync(container);

    const appendedProbe = appendSpy.mock.calls.some(
      ([node]) => node instanceof HTMLElement && node.style.height === '100lvh',
    );
    expect(appendedProbe).toBe(true);
  });
});
