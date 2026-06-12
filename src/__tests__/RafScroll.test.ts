import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RafScroll } from '../RafScroll';

// RafScroll の「管理モード（autoStart: false + advance）」の配線を検証する。
// これは「RafScroll と Core が別々の rAF ループを持ち、生成順しだいで scroll が
// 1 フレームずれる」問題を構造的に潰すための機構。
describe('RafScroll 管理モード (autoStart / advance)', () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // 自前 rAF が実際に走るとテストノイズ・非同期 scrollTo になるので no-op に固定。
    rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockReturnValue(0 as unknown as number);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    // jsdom は scrollHeight=0 で maxScroll が 0 になり clamp で入力が死ぬので、
    // スクロール余地を作っておく。
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 5000,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('既定（autoStart 省略）では自前 rAF ループを 1 回スケジュールする', () => {
    const rs = new RafScroll();
    expect(rafSpy).toHaveBeenCalledTimes(1);
    rs.destroy();
  });

  it('autoStart:false は自前 rAF を起動しない（所有者が advance で駆動する想定）', () => {
    const rs = new RafScroll({ autoStart: false });
    expect(rafSpy).not.toHaveBeenCalled();
    rs.destroy();
  });

  it('advance() は wheel で蓄積した scrollY を window.scrollTo に流す', () => {
    const scrollToSpy = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => {});
    const rs = new RafScroll({ autoStart: false });

    // wheel 入力で内部 accumulator を進める（deltaMode=0 → px そのまま）。
    const ev = new Event('wheel', { cancelable: true });
    Object.assign(ev, { deltaY: 240, deltaMode: 0 });
    window.dispatchEvent(ev);

    rs.advance(16);

    expect(scrollToSpy).toHaveBeenCalledWith(0, 240);
    rs.destroy();
  });

  it('autoStart:true のとき advance() は二重進行防止のため no-op', () => {
    const scrollToSpy = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => {});
    // autoStart=true（自前ループは rAF mock のため実際には走らない）。
    const rs = new RafScroll();

    const ev = new Event('wheel', { cancelable: true });
    Object.assign(ev, { deltaY: 240, deltaMode: 0 });
    window.dispatchEvent(ev);

    rs.advance(16);

    expect(scrollToSpy).not.toHaveBeenCalled();
    rs.destroy();
  });
});
