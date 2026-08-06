import { describe, it, expect, vi, afterEach } from "vitest";
import {
  resolveTextStyle,
  layoutLines,
  layoutLinesDom,
  rasterizeText,
  type ResolvedTextStyle,
} from "../TextRasterizer";

// 1 文字 10px の決定的計測。letterSpacing なし版。
const measure10 = (s: string) => s.length * 10;

function makeStyle(overrides: Partial<ResolvedTextStyle> = {}): ResolvedTextStyle {
  return {
    fontSize: 16,
    fontFamily: "sans-serif",
    fontWeight: "400",
    fontStyle: "normal",
    color: "rgb(0, 0, 0)",
    lineHeight: 20,
    letterSpacing: 0,
    textAlign: "left",
    verticalAlign: "top",
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    wordBreak: "normal",
    overflowWrap: "normal",
    lineBreak: "auto",
    ...overrides,
  };
}

interface MockCtx {
  scale: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  measureText: ReturnType<typeof vi.fn>;
  font: string;
  fillStyle: string;
  textAlign: string;
  textBaseline: string;
  letterSpacing?: string;
}

function makeCtx(withLetterSpacing = false): MockCtx {
  const ctx: MockCtx = {
    scale: vi.fn(),
    clearRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((s: string) => ({ width: s.length * 10 })),
    font: "",
    fillStyle: "",
    textAlign: "",
    textBaseline: "",
  };
  if (withLetterSpacing) ctx.letterSpacing = "";
  return ctx;
}

function spyCtx(ctx: MockCtx | null): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("layoutLines", () => {
  it("空文字は [] を返す", () => {
    expect(layoutLines("", 100, measure10)).toEqual([]);
  });

  it("maxWidth に収まる 1 行はそのまま 1 要素", () => {
    expect(layoutLines("ab cd", 100, measure10)).toEqual(["ab cd"]);
  });

  it("語が maxWidth 超で 2 行に折り返る（ちょうど収まる幅では折り返さない）", () => {
    // "aaa bbb" = 7 文字 = 70px。maxWidth 70 では 1 行。
    expect(layoutLines("aaa bbb", 70, measure10)).toEqual(["aaa bbb"]);
    // maxWidth 60 では 2 行。
    expect(layoutLines("aaa bbb", 60, measure10)).toEqual(["aaa", "bbb"]);
  });

  it("1 語が幅超過なら文字単位で分割される", () => {
    const word = "a".repeat(20); // 200px
    const lines = layoutLines(word, 100, measure10);
    expect(lines.every((l) => l.length <= 10)).toBe(true);
    expect(lines.join("")).toBe(word);
  });

  it("空白なし連続文字列（CJK 想定）が文字単位で折り返る", () => {
    const s = "あ".repeat(15); // 150px
    const lines = layoutLines(s, 100, measure10);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe(s);
  });
});

describe("resolveTextStyle", () => {
  function stubComputed(style: Partial<CSSStyleDeclaration>): void {
    vi.spyOn(window, "getComputedStyle").mockReturnValue(
      style as CSSStyleDeclaration,
    );
  }

  it("computed style から各値を抽出する", () => {
    stubComputed({
      fontSize: "24px",
      fontFamily: "Arial",
      fontWeight: "700",
      fontStyle: "italic",
      color: "rgb(255, 0, 0)",
      lineHeight: "30px",
      letterSpacing: "2px",
      textAlign: "center",
      paddingTop: "5px",
      paddingRight: "6px",
      paddingBottom: "7px",
      paddingLeft: "8px",
    });
    const el = document.createElement("div");
    const s = resolveTextStyle(el);
    expect(s.fontSize).toBe(24);
    expect(s.fontFamily).toBe("Arial");
    expect(s.fontWeight).toBe("700");
    expect(s.fontStyle).toBe("italic");
    expect(s.color).toBe("rgb(255, 0, 0)");
    expect(s.lineHeight).toBe(30);
    expect(s.letterSpacing).toBe(2);
    expect(s.textAlign).toBe("center");
    expect(s.paddingTop).toBe(5);
    expect(s.paddingLeft).toBe(8);
  });

  it("lineHeight: normal → fontSize * 1.2、letterSpacing: normal → 0", () => {
    stubComputed({ fontSize: "20px", lineHeight: "normal", letterSpacing: "normal" });
    const s = resolveTextStyle(document.createElement("div"));
    expect(s.lineHeight).toBeCloseTo(24);
    expect(s.letterSpacing).toBe(0);
  });

  it("textAlign: start / justify は left に丸める", () => {
    stubComputed({ fontSize: "16px", textAlign: "start" });
    expect(resolveTextStyle(document.createElement("div")).textAlign).toBe("left");
    stubComputed({ fontSize: "16px", textAlign: "justify" });
    expect(resolveTextStyle(document.createElement("div")).textAlign).toBe("left");
  });

  it("overrides が computed style より優先される（部分上書き）", () => {
    stubComputed({ fontSize: "16px", color: "rgb(0, 0, 0)", textAlign: "left" });
    const s = resolveTextStyle(document.createElement("div"), { fontSize: 40 });
    expect(s.fontSize).toBe(40);
    expect(s.color).toBe("rgb(0, 0, 0)"); // 他は抽出値のまま
  });

  it("overrides.padding が 4 辺に適用され、個別指定がそれを塗り替える", () => {
    stubComputed({
      fontSize: "16px",
      paddingTop: "5px",
      paddingRight: "5px",
      paddingBottom: "5px",
      paddingLeft: "5px",
    });
    const s = resolveTextStyle(document.createElement("div"), {
      padding: 20,
      paddingLeft: 40,
    });
    expect(s.paddingTop).toBe(20);
    expect(s.paddingRight).toBe(20);
    expect(s.paddingBottom).toBe(20);
    expect(s.paddingLeft).toBe(40);
  });

  it("padding のみ上書きしても CSS 由来の他プロパティは残る", () => {
    stubComputed({ fontSize: "16px", color: "rgb(1, 2, 3)", paddingTop: "5px" });
    const s = resolveTextStyle(document.createElement("div"), { paddingTop: 0 });
    expect(s.paddingTop).toBe(0);
    expect(s.color).toBe("rgb(1, 2, 3)");
  });

  it("alignContent から verticalAlign を解決し、overrides が優先される", () => {
    stubComputed({ fontSize: "16px", alignContent: "center" });
    expect(resolveTextStyle(document.createElement("div")).verticalAlign).toBe("center");
    stubComputed({ fontSize: "16px", alignContent: "flex-end" });
    expect(resolveTextStyle(document.createElement("div")).verticalAlign).toBe("bottom");
    // normal / 未対応環境は top に丸める
    stubComputed({ fontSize: "16px", alignContent: "normal" });
    expect(resolveTextStyle(document.createElement("div")).verticalAlign).toBe("top");
    stubComputed({ fontSize: "16px" });
    expect(resolveTextStyle(document.createElement("div")).verticalAlign).toBe("top");
    stubComputed({ fontSize: "16px", alignContent: "center" });
    expect(
      resolveTextStyle(document.createElement("div"), { verticalAlign: "bottom" }).verticalAlign,
    ).toBe("bottom");
  });
});

describe("layoutLinesDom", () => {
  it("レイアウトを持たない環境（jsdom）では null を返してフォールバックさせる", () => {
    expect(layoutLinesDom("aaa bbb ccc", 30, makeStyle())).toBeNull();
  });

  it("空文字は DOM を触らずに [] を返す", () => {
    expect(layoutLinesDom("", 100, makeStyle())).toEqual([]);
  });

  it("maxWidth が 0 以下なら null（病的な入力で行あたり 1 文字の矩形問い合わせを避ける）", () => {
    expect(layoutLinesDom("text", 0, makeStyle())).toBeNull();
    expect(layoutLinesDom("text", -10, makeStyle())).toBeNull();
  });

  it("計測用のミラー要素を body に残さない", () => {
    const before = document.body.children.length;
    layoutLinesDom("aaa bbb ccc", 30, makeStyle());
    expect(document.body.children.length).toBe(before);
  });
});

describe("rasterizeText", () => {
  it("canvas.width === ceil(cssWidth * pr)、ctx.scale が呼ばれる", () => {
    const ctx = makeCtx();
    spyCtx(ctx);
    const canvas = document.createElement("canvas");
    rasterizeText(canvas, "hi", makeStyle(), 100, 50, 2);
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);
    expect(ctx.scale).toHaveBeenCalledWith(2, 2);
  });

  it("ctx.font が {style} {weight} {size}px {family} 形式で設定される", () => {
    const ctx = makeCtx();
    spyCtx(ctx);
    rasterizeText(
      document.createElement("canvas"),
      "hi",
      makeStyle({ fontStyle: "italic", fontWeight: "700", fontSize: 24, fontFamily: "Arial" }),
      100,
      50,
      1,
    );
    expect(ctx.font).toBe("italic 700 24px Arial");
  });

  it("textAlign center で fillText の x が paddingLeft + contentWidth/2", () => {
    const ctx = makeCtx();
    spyCtx(ctx);
    rasterizeText(
      document.createElement("canvas"),
      "hi",
      makeStyle({ textAlign: "center", paddingLeft: 10, paddingRight: 10 }),
      100,
      50,
      1,
    );
    // contentWidth = 100 - 20 = 80, x = 10 + 40 = 50
    expect(ctx.fillText).toHaveBeenCalledWith("hi", 50, expect.any(Number));
  });

  it("textAlign right で fillText の x が cssWidth - paddingRight", () => {
    const ctx = makeCtx();
    spyCtx(ctx);
    rasterizeText(
      document.createElement("canvas"),
      "hi",
      makeStyle({ textAlign: "right", paddingRight: 10 }),
      100,
      50,
      1,
    );
    expect(ctx.fillText).toHaveBeenCalledWith("hi", 90, expect.any(Number));
  });

  it("2 行テキストで fillText が 2 回、y が paddingTop + lh/2 と + lh*1.5", () => {
    const ctx = makeCtx();
    spyCtx(ctx);
    // maxWidth 30（contentWidth）に対して "aaa bbb" は 2 行に折れる
    rasterizeText(
      document.createElement("canvas"),
      "aaa bbb",
      makeStyle({ lineHeight: 20, paddingTop: 4 }),
      30,
      100,
      1,
    );
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
    const ys = ctx.fillText.mock.calls.map((c) => c[2]);
    expect(ys[0]).toBeCloseTo(4 + 10); // paddingTop + lh/2
    expect(ys[1]).toBeCloseTo(4 + 10 + 20); // + lh
  });

  it("verticalAlign: center で paddingTop/Bottom を除いた領域の中央に寄る", () => {
    const ctx = makeCtx();
    spyCtx(ctx);
    // cssHeight 100, padding 上 10 / 下 30 → contentHeight 60、1 行 20px なので slack 40
    rasterizeText(
      document.createElement("canvas"),
      "hi",
      makeStyle({
        lineHeight: 20,
        paddingTop: 10,
        paddingBottom: 30,
        verticalAlign: "center",
      }),
      1000,
      100,
      1,
    );
    expect(ctx.fillText.mock.calls[0][2]).toBeCloseTo(10 + 20 + 10); // paddingTop + slack/2 + lh/2
  });

  it("verticalAlign: bottom で下端が cssHeight - paddingBottom に揃う", () => {
    const ctx = makeCtx();
    spyCtx(ctx);
    rasterizeText(
      document.createElement("canvas"),
      "hi",
      makeStyle({
        lineHeight: 20,
        paddingTop: 10,
        paddingBottom: 30,
        verticalAlign: "bottom",
      }),
      1000,
      100,
      1,
    );
    // ブロック下端 = 100 - 30 = 70、その 1 行ぶん上が基準なのでベースラインは 60
    expect(ctx.fillText.mock.calls[0][2]).toBeCloseTo(60);
  });

  it("verticalAlign: top は paddingBottom の影響を受けない（既定の互換）", () => {
    const ctx = makeCtx();
    spyCtx(ctx);
    rasterizeText(
      document.createElement("canvas"),
      "hi",
      makeStyle({ lineHeight: 20, paddingTop: 4, paddingBottom: 40 }),
      1000,
      100,
      1,
    );
    expect(ctx.fillText.mock.calls[0][2]).toBeCloseTo(4 + 10);
  });

  it("コンテンツ領域に収まらない場合もクランプせず溢れたまま描く", () => {
    const ctx = makeCtx();
    spyCtx(ctx);
    // contentHeight 20 に対して 3 行 × 20px = 60 → slack -40
    rasterizeText(
      document.createElement("canvas"),
      "aaa bbb ccc",
      makeStyle({
        lineHeight: 20,
        paddingTop: 10,
        paddingBottom: 10,
        verticalAlign: "center",
      }),
      30,
      40,
      1,
    );
    expect(ctx.fillText).toHaveBeenCalledTimes(3);
    // paddingTop + slack/2 + lh/2 = 10 - 20 + 10 = 0（負方向にもクランプしない）
    expect(ctx.fillText.mock.calls[0][2]).toBeCloseTo(0);
  });

  it("letterSpacing > 0 かつ ctx に letterSpacing なし → per-char フォールバックで文字数ぶん fillText", () => {
    const ctx = makeCtx(false); // letterSpacing プロパティなし
    spyCtx(ctx);
    rasterizeText(
      document.createElement("canvas"),
      "abc",
      makeStyle({ letterSpacing: 3 }),
      1000,
      50,
      1,
    );
    expect(ctx.fillText).toHaveBeenCalledTimes(3);
  });

  it("getContext が null → false を返し例外を投げない", () => {
    spyCtx(null);
    const result = rasterizeText(
      document.createElement("canvas"),
      "hi",
      makeStyle(),
      100,
      50,
      1,
    );
    expect(result).toBe(false);
  });

  it("辺長 4096 クランプ（cssWidth 3000 × pr 2 → canvas.width === 4096）", () => {
    const ctx = makeCtx();
    spyCtx(ctx);
    const canvas = document.createElement("canvas");
    rasterizeText(canvas, "hi", makeStyle(), 3000, 1000, 2);
    expect(canvas.width).toBe(4096);
  });
});
