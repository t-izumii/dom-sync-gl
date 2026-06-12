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

  it('updateSize で resize callback が発火する', () => {
    const sync = new ScrollSync(container);
    const cb = vi.fn();
    sync.setResizeCallback(cb);

    sync.updateSize(1200, 900);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ width: 1200, height: 900 });
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
});
