import { describe, it, expect, vi } from 'vitest';
import { DevTools } from '../DevTools';

describe('DevTools', () => {
  it('stats / gui を渡さない場合、beginStats/endStats は何もせず getGUI は null', () => {
    const devTools = new DevTools({});

    expect(() => devTools.beginStats()).not.toThrow();
    expect(() => devTools.endStats()).not.toThrow();
    expect(devTools.getGUI()).toBeNull();
  });

  it('stats を渡すと beginStats/endStats がそのまま begin()/end() に委譲される', () => {
    const stats = { begin: vi.fn(), end: vi.fn() };
    const devTools = new DevTools({ stats: stats as unknown as never });

    devTools.beginStats();
    devTools.endStats();

    expect(stats.begin).toHaveBeenCalledTimes(1);
    expect(stats.end).toHaveBeenCalledTimes(1);
  });

  it('gui を渡すと getGUI() が同一インスタンスをそのまま返す', () => {
    const gui = { destroy: vi.fn() };
    const devTools = new DevTools({ gui: gui as unknown as never });

    expect(devTools.getGUI()).toBe(gui);
  });

  it('gui/stats のインスタンスを生成・破棄しない（呼び出し元の所有物であることの回帰）', () => {
    const gui = { destroy: vi.fn() };
    const stats = { begin: vi.fn(), end: vi.fn() };
    const devTools = new DevTools({
      gui: gui as unknown as never,
      stats: stats as unknown as never,
    });

    devTools.beginStats();
    devTools.endStats();

    // DevTools 自身に dispose 相当のメソッドは無く、gui.destroy() / stats の破棄も呼ばれない
    expect(gui.destroy).not.toHaveBeenCalled();
    expect((devTools as unknown as { dispose?: () => void }).dispose).toBeUndefined();
  });
});
