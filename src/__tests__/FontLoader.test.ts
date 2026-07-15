import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadFont, __resetFontLoadCacheForTests } from "../FontLoader";

beforeEach(() => {
  // モジュールスコープの共有キャッシュがテスト間で漏れないよう毎回クリアする。
  __resetFontLoadCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete (document as unknown as { fonts?: unknown }).fonts;
});

describe("loadFont", () => {
  it("FontFace が存在しない環境では何もせず即 resolve する", async () => {
    // FontFace 未定義の環境をシミュレート
    vi.stubGlobal("FontFace", undefined);
    await expect(
      loadFont([{ family: "X", url: "/x.woff2" }]),
    ).resolves.toBeUndefined();
  });

  it("単体オブジェクトを渡しても配列同様にロードされる", async () => {
    const loadMock = vi.fn().mockResolvedValue(undefined);
    const created: Array<{ family: string; source: string }> = [];
    class MockFontFace {
      load = loadMock;
      constructor(family: string, source: string) {
        created.push({ family, source });
      }
    }
    vi.stubGlobal("FontFace", MockFontFace);
    const addMock = vi.fn();
    Object.defineProperty(document, "fonts", {
      value: { add: addMock, status: "loading", ready: Promise.resolve(), load: vi.fn() },
      configurable: true,
    });

    // 配列ではなく単体オブジェクトを渡す。
    await loadFont({ family: "Single", url: "/single.woff2" });

    expect(created).toHaveLength(1);
    expect(created[0].family).toBe("Single");
    expect(created[0].source).toBe("url(/single.woff2)");
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(addMock).toHaveBeenCalledTimes(1);
  });

  it("読み込み成功したフォントを document.fonts.add に登録する", async () => {
    const loadMock = vi.fn().mockResolvedValue(undefined);
    const created: Array<{ family: string; source: string; descriptors: unknown }> = [];
    class MockFontFace {
      family: string;
      source: string;
      descriptors: unknown;
      load = loadMock;
      constructor(family: string, source: string, descriptors: unknown) {
        this.family = family;
        this.source = source;
        this.descriptors = descriptors;
        created.push({ family, source, descriptors });
      }
    }
    vi.stubGlobal("FontFace", MockFontFace);
    const addMock = vi.fn();
    Object.defineProperty(document, "fonts", {
      value: { add: addMock, status: "loading", ready: Promise.resolve(), load: vi.fn() },
      configurable: true,
    });

    await loadFont([
      { family: "Custom", url: "/custom.woff2", weight: "700", style: "italic" },
    ]);

    expect(created).toHaveLength(1);
    expect(created[0].family).toBe("Custom");
    expect(created[0].source).toBe("url(/custom.woff2)");
    expect(created[0].descriptors).toMatchObject({ weight: "700", style: "italic" });
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(addMock).toHaveBeenCalledTimes(1);
  });

  it("url() / local() 構文の文字列はそのまま渡す", async () => {
    const created: string[] = [];
    class MockFontFace {
      load = vi.fn().mockResolvedValue(undefined);
      constructor(_family: string, source: string) {
        created.push(source);
      }
    }
    vi.stubGlobal("FontFace", MockFontFace);
    Object.defineProperty(document, "fonts", {
      value: { add: vi.fn(), status: "loading", ready: Promise.resolve(), load: vi.fn() },
      configurable: true,
    });

    await loadFont([{ family: "A", url: "url(/a.woff2) format('woff2')" }]);
    expect(created[0]).toBe("url(/a.woff2) format('woff2')");
  });

  it("読み込み失敗したフォントは console.warn でログし、全体は失敗させない", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const addMock = vi.fn();
    class MockFontFace {
      family: string;
      load: () => Promise<void>;
      constructor(family: string) {
        this.family = family;
        // "Bad" だけ reject する
        this.load =
          family === "Bad"
            ? () => Promise.reject(new Error("404"))
            : () => Promise.resolve();
      }
    }
    vi.stubGlobal("FontFace", MockFontFace);
    Object.defineProperty(document, "fonts", {
      value: { add: addMock, status: "loading", ready: Promise.resolve(), load: vi.fn() },
      configurable: true,
    });

    await expect(
      loadFont([
        { family: "Good", url: "/good.woff2" },
        { family: "Bad", url: "/bad.woff2" },
      ]),
    ).resolves.toBeUndefined();

    expect(addMock).toHaveBeenCalledTimes(1); // Good のみ登録
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain("Bad");
  });

  it("同じ family+url を2回連続で呼ぶと FontFace/load は再生成されない（キャッシュ共有）", async () => {
    const ctorSpy = vi.fn();
    const loadMock = vi.fn().mockResolvedValue(undefined);
    class MockFontFace {
      load = loadMock;
      constructor(family: string) {
        ctorSpy(family);
      }
    }
    vi.stubGlobal("FontFace", MockFontFace);
    const addMock = vi.fn();
    Object.defineProperty(document, "fonts", {
      value: { add: addMock, status: "loading", ready: Promise.resolve(), load: vi.fn() },
      configurable: true,
    });

    const src = { family: "Cached", url: "/cached.woff2" };
    await loadFont([src]);
    await loadFont([src]);

    expect(ctorSpy).toHaveBeenCalledTimes(1);
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(addMock).toHaveBeenCalledTimes(1);
  });

  it("同じ family+url を並行呼び出ししても FontFace は1回しか生成されない（重複フェッチ防止）", async () => {
    const ctorSpy = vi.fn();
    let resolveLoad!: () => void;
    const loadMock = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveLoad = r;
        }),
    );
    class MockFontFace {
      load = loadMock;
      constructor(family: string) {
        ctorSpy(family);
      }
    }
    vi.stubGlobal("FontFace", MockFontFace);
    Object.defineProperty(document, "fonts", {
      value: { add: vi.fn(), status: "loading", ready: Promise.resolve(), load: vi.fn() },
      configurable: true,
    });

    const src = { family: "Parallel", url: "/parallel.woff2" };
    const both = Promise.all([loadFont([src]), loadFont([src])]);
    // 進行中（load 未解決）の段階でも生成は1回だけ。
    expect(ctorSpy).toHaveBeenCalledTimes(1);
    expect(loadMock).toHaveBeenCalledTimes(1);

    resolveLoad();
    await both;

    expect(ctorSpy).toHaveBeenCalledTimes(1);
    expect(loadMock).toHaveBeenCalledTimes(1);
  });

  it("1回目のロードが失敗すると2回目は再試行される（失敗エントリはキャッシュに残さない）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctorSpy = vi.fn();
    let attempt = 0;
    class MockFontFace {
      load: () => Promise<void>;
      constructor(family: string) {
        ctorSpy(family);
        attempt += 1;
        // 1回目だけ失敗、2回目は成功。
        this.load =
          attempt === 1
            ? () => Promise.reject(new Error("network"))
            : () => Promise.resolve();
      }
    }
    vi.stubGlobal("FontFace", MockFontFace);
    const addMock = vi.fn();
    Object.defineProperty(document, "fonts", {
      value: { add: addMock, status: "loading", ready: Promise.resolve(), load: vi.fn() },
      configurable: true,
    });

    const src = { family: "Retry", url: "/retry.woff2" };
    await loadFont([src]); // 失敗 → キャッシュから削除
    await loadFont([src]); // 再試行 → 成功

    expect(ctorSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(addMock).toHaveBeenCalledTimes(1); // 2回目の成功時のみ登録
  });
});
