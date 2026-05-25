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

    mockNow = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => mockNow);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('コンストラクタで container を fixed inset:0 + overflow:hidden で viewport にロックする', () => {
    new ScrollSync(container);
    expect(container.style.position).toBe('fixed');
    expect(container.style.left).toBe('0px');
    expect(container.style.top).toBe('0px');
    expect(container.style.overflow).toBe('hidden');
    expect(container.style.pointerEvents).toBe('none');
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

  it('update() は transform を触らない (fixed container なので per-frame 補正は不要)', () => {
    const sync = new ScrollSync(container);
    const before = container.style.transform;
    sync.update(0, 400);
    expect(container.style.transform).toBe(before);
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

  it('enabled=false にすると update() が no-op になり strength tracking が止まる', () => {
    const sync = new ScrollSync(container, { trackStrength: true });
    mockNow = 16;
    sync.update(0, 500);
    const s1 = sync.strength;
    expect(s1).toBeGreaterThan(0);

    sync.enabled = false;
    mockNow = 32;
    sync.update(0, 1000);
    // disable 中は strength が更新されないので s1 のまま (時間 t が進んでいないので decay も発火しない)
    expect(sync.strength).toBe(s1);
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
    expect(container.style.pointerEvents).toBe('');
  });

  it('destroy(): ScrollSync 前に当たっていた inline style は復元される', () => {
    container.style.position = 'relative';
    container.style.pointerEvents = 'auto';
    container.style.overflow = 'auto';

    const sync = new ScrollSync(container);
    expect(container.style.position).toBe('fixed');
    expect(container.style.pointerEvents).toBe('none');
    expect(container.style.overflow).toBe('hidden');

    sync.destroy();
    expect(container.style.position).toBe('relative');
    expect(container.style.pointerEvents).toBe('auto');
    expect(container.style.overflow).toBe('auto');
  });
});
