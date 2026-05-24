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
    // body.scrollHeight を クランプに使うので明示的にモック。
    // 3000px のコンテンツを想定: padding を full まで取れる余裕がある。
    Object.defineProperty(document.body, 'scrollHeight', {
      value: 3000,
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

  it('コンストラクタで container に絶対配置 + overflow:hidden を当てる', () => {
    new ScrollSync(container);
    expect(container.style.position).toBe('absolute');
    expect(container.style.left).toBe('0px');
    expect(container.style.top).toBe('0px');
    expect(container.style.overflow).toBe('hidden');
    expect(container.style.pointerEvents).toBe('none');
    expect(container.style.willChange).toBe('transform');
  });

  it('default padding は 0（CSS rect 尊重）', () => {
    const sync = new ScrollSync(container);
    const rect = sync.logicalRect;
    // padding 0 → 上下加算なし (-0 になりうるので closeTo で比較)
    expect(rect.top).toBeCloseTo(0, 5);
    expect(rect.width).toBe(1000);
    expect(rect.height).toBe(800);
  });

  it('updateSize で viewport 幅変更が container サイズに反映される', () => {
    const sync = new ScrollSync(container, { padding: 0.1 });
    sync.updateSize(1200);
    expect(container.style.width).toBe('1200px');
    // height = innerHeight * (1 + padding * 2) = 800 * 1.2 = 960
    expect(container.style.height).toBe('960px');
    expect(sync.logicalRect.width).toBe(1200);
  });

  it('update(scrollX, scrollY) で container transform に scroll - paddingPx が反映される', () => {
    const sync = new ScrollSync(container, { padding: 0.1 });
    // viewport 800, padding 0.1 → paddingPx = 80
    // body.scrollHeight = 3000 → maxPadding = 3000 - 400 - 800 = 1800 (十分余裕)
    // effective = min(80, 1800) = 80
    // translate y = scrollY - 80 = 400 - 80 = 320
    sync.update(0, 400);
    expect(container.style.transform).toBe('translate3d(0px, 320px, 0)');
  });

  it('スクロール末尾近くで effective padding がクランプされ縮む', () => {
    const sync = new ScrollSync(container, { padding: 0.1 });
    // requested = 80. body.scrollHeight = 3000, vh = 800
    // scrollY = 2960 → maxPadding = 3000 - 2960 - 800 = -760 → clamp(>= 0) → 0
    sync.update(0, 2960);
    expect(sync.effectivePadding).toBe(0);
    // container.height = vh + 2*0 = 800
    expect(container.style.height).toBe('800px');
    // logicalRect.top も 0 に（-effective が -0 になりうるので closeTo で比較）
    expect(sync.logicalRect.top).toBeCloseTo(0, 5);
    expect(sync.logicalRect.height).toBe(800);
  });

  it('スクロール末尾の境界では effective padding が滑らかに縮む（クランプ式）', () => {
    const sync = new ScrollSync(container, { padding: 0.1 });
    // body.scrollHeight = 3000, vh = 800. 末尾までの距離 = 3000 - scrollY - 800
    // requested = 80
    // scrollY = 2150 → max = 50 → effective = 50
    sync.update(0, 2150);
    expect(sync.effectivePadding).toBe(50);
    expect(container.style.height).toBe(`${800 + 100}px`); // 900
  });

  it('effective padding 変化時に resize callback が発火する', () => {
    const sync = new ScrollSync(container, { padding: 0.1 });
    const cb = vi.fn();
    sync.setResizeCallback(cb);

    // 末尾近くまでスクロール → effective が縮む → callback
    sync.update(0, 2960);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ width: 1000, height: 800 });

    // 同じ scrollY なら effective 不変 → callback 発火しない
    sync.update(0, 2960);
    expect(cb).toHaveBeenCalledTimes(1);

    // 戻ってきたら再発火
    sync.update(0, 0);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith({ width: 1000, height: 960 });
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

  it('enabled=false にすると update() が no-op になり transform は disable 直前の値で固定', () => {
    const sync = new ScrollSync(container);
    sync.update(0, 100);
    const frozen = container.style.transform;
    expect(frozen).not.toBe('');

    sync.enabled = false;
    expect(container.style.transform).toBe(frozen);

    sync.update(0, 500);
    expect(container.style.transform).toBe(frozen);
  });

  it('destroy() で container のスタイルが「ScrollSync 前の inline 値」に復元される', () => {
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

  it('strength: trackStrength=false なら常に 0', () => {
    const sync = new ScrollSync(container, { trackStrength: false });
    mockNow = 16;
    sync.update(0, 500);
    expect(sync.strength).toBe(0);
  });

  it('短いページ (body.scrollHeight = viewport) では effective padding が 0 のまま', () => {
    Object.defineProperty(document.body, 'scrollHeight', {
      value: 800,
      writable: true,
      configurable: true,
    });
    const sync = new ScrollSync(container, { padding: 0.1 });
    // 初回 updateSize 時点では effective = requested = 80（未クランプ）。
    // 最初の update() で body.scrollHeight - 0 - 800 = 0 にクランプされる。
    sync.update(0, 0);
    expect(sync.effectivePadding).toBe(0);
    // canvas height = viewport ぴったり → body.scrollHeight 寄与は viewport だけ
    expect(container.style.height).toBe('800px');
  });
});
