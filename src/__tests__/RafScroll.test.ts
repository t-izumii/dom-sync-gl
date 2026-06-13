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

// 外部 / programmatic スクロール（アンカーリンク・キーボード・スクロールバー・検索ジャンプ等）の
// 取り込み。これが無いと外部スクロール後の最初の wheel/touch 入力で古い accumulator へ巻き戻る。
describe('RafScroll 外部スクロール同期 (scroll listener)', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(
      0 as unknown as number,
    );
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 5000,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      configurable: true,
    });
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    vi.restoreAllMocks();
  });

  it('外部スクロール（アンカー等）を検知して _scrollY を window.scrollY に再同期する', () => {
    const rs = new RafScroll({ autoStart: false });
    expect(rs.scrollY).toBe(0);

    // アンカーリンク等でブラウザがネイティブにジャンプ（RafScroll は wheel/touch を受けていない）
    Object.defineProperty(window, 'scrollY', { value: 3000, configurable: true });
    window.dispatchEvent(new Event('scroll'));

    // accumulator が追従していれば、次入力で巻き戻らない
    expect(rs.scrollY).toBe(3000);
    rs.destroy();
  });

  it('再同期後の wheel 入力は現在位置からの相対移動になる（巻き戻らない）', () => {
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const rs = new RafScroll({ autoStart: false });

    // アンカージャンプ → scroll で再同期
    Object.defineProperty(window, 'scrollY', { value: 3000, configurable: true });
    window.dispatchEvent(new Event('scroll'));

    // 以降の wheel は 3000 を起点に積まれる（0 起点ではない）
    const ev = new Event('wheel', { cancelable: true });
    Object.assign(ev, { deltaY: 120, deltaMode: 0 });
    window.dispatchEvent(ev);
    rs.advance(16);

    expect(scrollToSpy).toHaveBeenCalledWith(0, 3120);
    rs.destroy();
  });

  it('自分の scrollTo 由来の scroll は再同期しない（フィードバック防止）', () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const rs = new RafScroll({ autoStart: false });

    // wheel → advance で _scrollY=240, _lastAppliedY=240
    const ev = new Event('wheel', { cancelable: true });
    Object.assign(ev, { deltaY: 240, deltaMode: 0 });
    window.dispatchEvent(ev);
    rs.advance(16);

    // ブラウザが scrollTo(0,240) を反映して scroll を発火
    Object.defineProperty(window, 'scrollY', { value: 240, configurable: true });
    window.dispatchEvent(new Event('scroll'));

    // 自分由来なので無視され、_scrollY は 240 のまま
    expect(rs.scrollY).toBe(240);
    rs.destroy();
  });
});
