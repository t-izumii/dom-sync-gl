import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// スムーズスクロールの実体は Lenis に委譲済み。ここでは RafScroll ラッパーが
// 「管理モード（autoStart:false + advance）」と公開 API（scrollY / enabled / destroy）を
// Lenis に正しく橋渡ししているかだけを検証する。Lenis 本体の挙動は Lenis 側の責務。
//
// vi.mock のファクトリは巻き上げられるため、参照する Mock 定義も vi.hoisted で先頭に巻き上げる。
const { lenisInstances, MockLenis } = vi.hoisted(() => {
  const instances: any[] = [];
  class MockLenis {
    options: Record<string, unknown>;
    scroll = 0;
    private _stopped = false;
    raf = vi.fn();
    start = vi.fn(() => {
      this._stopped = false;
    });
    stop = vi.fn(() => {
      this._stopped = true;
    });
    destroy = vi.fn();

    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
      instances.push(this);
    }

    get isStopped(): boolean {
      return this._stopped;
    }
  }
  return { lenisInstances: instances, MockLenis };
});

vi.mock('lenis', () => ({ default: MockLenis }));

import { RafScroll } from '../RafScroll';

type MockLenisInstance = InstanceType<typeof MockLenis>;
const last = (): MockLenisInstance =>
  lenisInstances[lenisInstances.length - 1];

describe('RafScroll 管理モード (autoStart / advance)', () => {
  beforeEach(() => {
    lenisInstances.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('既定（autoStart 省略）では Lenis を autoRaf:true で生成する（自走モード）', () => {
    const rs = new RafScroll();
    expect(last().options.autoRaf).toBe(true);
    rs.destroy();
  });

  it('autoStart:false では Lenis を autoRaf:false で生成する（所有者が advance で駆動）', () => {
    const rs = new RafScroll({ autoStart: false });
    expect(last().options.autoRaf).toBe(false);
    rs.destroy();
  });

  it('autoStart は Lenis へ漏らさず、それ以外のオプションは Lenis に渡す', () => {
    const rs = new RafScroll({ autoStart: false, lerp: 0.2, wheelMultiplier: 2 });
    const opts = last().options;
    expect(opts.autoStart).toBeUndefined();
    expect(opts.lerp).toBe(0.2);
    expect(opts.wheelMultiplier).toBe(2);
    rs.destroy();
  });

  it('管理モード（autoStart:false）の advance() は lenis.raf(now) を駆動する', () => {
    const rs = new RafScroll({ autoStart: false });
    rs.advance(16);
    expect(last().raf).toHaveBeenCalledWith(16);
    rs.destroy();
  });

  it('autoStart:true のとき advance() は二重進行防止のため no-op', () => {
    const rs = new RafScroll();
    rs.advance(16);
    expect(last().raf).not.toHaveBeenCalled();
    rs.destroy();
  });

  it('destroy() 後の advance() は lenis.raf を呼ばない', () => {
    const rs = new RafScroll({ autoStart: false });
    rs.destroy();
    rs.advance(16);
    expect(last().raf).not.toHaveBeenCalled();
  });
});

describe('RafScroll 公開 API の委譲', () => {
  beforeEach(() => {
    lenisInstances.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('scrollY は lenis.scroll を返す', () => {
    const rs = new RafScroll({ autoStart: false });
    last().scroll = 3000;
    expect(rs.scrollY).toBe(3000);
    rs.destroy();
  });

  it('enabled=false は lenis.stop()、=true は lenis.start() を呼ぶ', () => {
    const rs = new RafScroll({ autoStart: false });
    rs.enabled = false;
    expect(last().stop).toHaveBeenCalledTimes(1);
    expect(rs.enabled).toBe(false);

    rs.enabled = true;
    expect(last().start).toHaveBeenCalledTimes(1);
    expect(rs.enabled).toBe(true);
    rs.destroy();
  });

  it('destroy() は lenis.destroy() を呼び、二重呼び出しは無害', () => {
    const rs = new RafScroll({ autoStart: false });
    rs.destroy();
    rs.destroy();
    expect(last().destroy).toHaveBeenCalledTimes(1);
  });

  it('lenis getter は内部インスタンスを返す（scrollTo 等の高度操作用）', () => {
    const rs = new RafScroll({ autoStart: false });
    expect(rs.lenis).toBe(last());
    rs.destroy();
  });
});
