import type { TextStyleOverrides } from "./types";

export interface ResolvedTextStyle {
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  color: string;
  lineHeight: number;
  letterSpacing: number;
  textAlign: "left" | "center" | "right";
  verticalAlign: "top" | "center" | "bottom";
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  /* 行分割をブラウザに任せる際にミラー要素へ写す（layoutLinesDom を参照）。 */
  wordBreak: string;
  overflowWrap: string;
  lineBreak: string;
}

// canvas 辺長の上限。巨大要素 × 高 DPR で VRAM が爆発しないようクランプする。
const MAX_CANVAS_SIZE = 4096;

function num(value: string | null | undefined, fallback = 0): number {
  const n = parseFloat(value ?? "");
  return Number.isFinite(n) ? n : fallback;
}

/**
 * canvas 2D の ctx.font に渡す font-shorthand 文字列を組み立てる。
 * font-style / font-weight / font-size / font-family を CSS 準拠の順序で連結する。
 */
function buildFontSpec(style: ResolvedTextStyle): string {
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
}

export function resolveTextStyle(
  el: HTMLElement,
  overrides?: TextStyleOverrides,
): ResolvedTextStyle {
  const cs = getComputedStyle(el);

  const fontSize = num(cs.fontSize, 16);
  const rawLineHeight = cs.lineHeight;
  // "normal" は環境依存だが、DOM 準拠の近似として fontSize * 1.2 を使う。
  const lineHeight =
    rawLineHeight === "normal" || rawLineHeight === ""
      ? fontSize * 1.2
      : num(rawLineHeight, fontSize * 1.2);
  const rawLetterSpacing = cs.letterSpacing;
  const letterSpacing =
    rawLetterSpacing === "normal" || rawLetterSpacing === ""
      ? 0
      : num(rawLetterSpacing, 0);

  const rawAlign = cs.textAlign;
  // start / end / justify / 空文字は left に丸める（justify の両端揃え描画は非対応）。
  const textAlign: "left" | "center" | "right" =
    rawAlign === "center" || rawAlign === "right" ? rawAlign : "left";

  // 縦揃えの CSS 側の対応物は align-content（block コンテナでも有効）。
  // vertical-align はインラインボックス用でブロックの縦揃えには使えないため採らない。
  // normal / stretch / 未対応環境は top に丸める。
  const rawVAlign = cs.alignContent;
  const verticalAlign: "top" | "center" | "bottom" =
    rawVAlign === "center"
      ? "center"
      : rawVAlign === "end" || rawVAlign === "flex-end"
        ? "bottom"
        : "top";

  const resolved: ResolvedTextStyle = {
    fontSize,
    fontFamily: cs.fontFamily || "sans-serif",
    fontWeight: cs.fontWeight || "400",
    fontStyle: cs.fontStyle || "normal",
    color: cs.color || "rgb(0, 0, 0)",
    lineHeight,
    letterSpacing,
    textAlign,
    verticalAlign,
    paddingTop: num(cs.paddingTop),
    paddingRight: num(cs.paddingRight),
    paddingBottom: num(cs.paddingBottom),
    paddingLeft: num(cs.paddingLeft),
    wordBreak: cs.wordBreak || "normal",
    overflowWrap: cs.overflowWrap || "normal",
    lineBreak: cs.lineBreak || "auto",
  };

  if (overrides) {
    if (overrides.fontSize !== undefined) resolved.fontSize = overrides.fontSize;
    if (overrides.fontFamily !== undefined) resolved.fontFamily = overrides.fontFamily;
    if (overrides.fontWeight !== undefined) resolved.fontWeight = String(overrides.fontWeight);
    if (overrides.fontStyle !== undefined) resolved.fontStyle = overrides.fontStyle;
    if (overrides.color !== undefined) resolved.color = overrides.color;
    if (overrides.lineHeight !== undefined) resolved.lineHeight = overrides.lineHeight;
    if (overrides.letterSpacing !== undefined) resolved.letterSpacing = overrides.letterSpacing;
    if (overrides.textAlign !== undefined) resolved.textAlign = overrides.textAlign;
    if (overrides.verticalAlign !== undefined) resolved.verticalAlign = overrides.verticalAlign;
    // 一括指定を先に当ててから個別指定で塗り替える（CSS の padding → padding-* と同じ優先順）。
    if (overrides.padding !== undefined) {
      resolved.paddingTop = overrides.padding;
      resolved.paddingRight = overrides.padding;
      resolved.paddingBottom = overrides.padding;
      resolved.paddingLeft = overrides.padding;
    }
    if (overrides.paddingTop !== undefined) resolved.paddingTop = overrides.paddingTop;
    if (overrides.paddingRight !== undefined) resolved.paddingRight = overrides.paddingRight;
    if (overrides.paddingBottom !== undefined) resolved.paddingBottom = overrides.paddingBottom;
    if (overrides.paddingLeft !== undefined) resolved.paddingLeft = overrides.paddingLeft;
  }

  return resolved;
}

/**
 * ブラウザ自身に行分割させ、その結果を行の配列として読み取る。
 *
 * canvas 2D には行分割の API が無いため、自前実装（layoutLines）では UAX #14 の
 * 分割規則も日本語の禁則処理も再現できず、DOM と改行位置がずれる。ここでは
 * 非表示のミラー要素へ同じ字送りでテキストを流し込み、1 文字ずつ Range の矩形を
 * 取って top が変わったところを行の切れ目とみなすことで、DOM と同じ改行位置を得る。
 *
 * ミラーは呼び出しごとに作って消す。使い回すと隠し要素がページに残り続けるうえ、
 * 律速はレイアウト問い合わせ側なので使い回しても速くならない。
 *
 * @returns 行の配列。レイアウトを持たない環境（SSR / jsdom 等）では null を返し、
 *   呼び出し側は layoutLines へフォールバックする
 */
export function layoutLinesDom(
  text: string,
  maxWidth: number,
  style: ResolvedTextStyle,
): string[] | null {
  if (typeof document === "undefined" || !document.body) return null;
  if (text === "") return [];
  if (!(maxWidth > 0)) return null;

  const mirror = document.createElement("div");
  const s = mirror.style;
  s.position = "absolute";
  s.top = "0";
  s.left = "-99999px";
  // display: none だと行ボックスが生成されず矩形が取れない。visibility なら生成される。
  s.visibility = "hidden";
  s.pointerEvents = "none";
  s.margin = "0";
  s.padding = "0";
  s.border = "0";
  s.boxSizing = "border-box";
  s.width = `${maxWidth}px`;
  s.whiteSpace = "normal";
  s.fontFamily = style.fontFamily;
  s.fontSize = `${style.fontSize}px`;
  s.fontWeight = style.fontWeight;
  s.fontStyle = style.fontStyle;
  s.lineHeight = `${style.lineHeight}px`;
  s.letterSpacing = `${style.letterSpacing}px`;
  s.wordBreak = style.wordBreak;
  s.overflowWrap = style.overflowWrap;
  s.lineBreak = style.lineBreak;
  mirror.textContent = text;
  document.body.appendChild(mirror);

  try {
    const node = mirror.firstChild;
    if (!node) return null;

    const range = document.createRange();
    range.selectNodeContents(node);
    // レイアウトを持たない環境ではここが空になるので、そのまま呼び出し側へ返す。
    if (range.getClientRects().length === 0) return null;

    // 行が変わると top が lineHeight ぶん進む。同一行内でも
    // フォントフォールバックで多少ぶれるため、半分を閾値にする。
    const tolerance = Math.max(1, style.lineHeight * 0.5);
    const lines: string[] = [];
    let current = "";
    let currentTop: number | null = null;
    let offset = 0;

    // サロゲートペアを割らないようコードポイント単位で進める。
    for (const ch of text) {
      const start = offset;
      offset += ch.length;
      range.setStart(node, start);
      range.setEnd(node, offset);
      const rects = range.getClientRects();
      const rect = rects.length > 0 ? rects[rects.length - 1] : null;

      // 折り返し位置で潰れた空白は矩形を持たない。行の判定には使わない。
      if (rect === null) {
        current += ch;
        continue;
      }
      if (currentTop === null) {
        currentTop = rect.top;
      } else if (rect.top - currentTop > tolerance) {
        lines.push(current);
        current = "";
        currentTop = rect.top;
      }
      current += ch;
    }
    lines.push(current);

    // 折り返し位置の空白は DOM 側でも行末にぶら下がるだけで描画されない。
    return lines.map((line) => line.trim());
  } catch {
    // Range API が未実装の環境。フォールバックさせる。
    return null;
  } finally {
    mirror.remove();
  }
}

export function layoutLines(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  if (text === "") return [];

  const words = text.split(" ").filter((w) => w.length > 0);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = "";

  const pushChars = (word: string): void => {
    // 1 語が maxWidth を超える場合（長い英単語・CJK 連続文字列）は文字単位で分割する。
    let chunk = "";
    for (const ch of word) {
      const candidate = chunk + ch;
      if (chunk !== "" && measure(candidate) > maxWidth) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk = candidate;
      }
    }
    current = chunk;
  };

  for (const word of words) {
    const candidate = current === "" ? word : current + " " + word;
    if (current === "") {
      if (measure(word) > maxWidth) {
        pushChars(word);
      } else {
        current = word;
      }
    } else if (measure(candidate) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = "";
      if (measure(word) > maxWidth) {
        pushChars(word);
      } else {
        current = word;
      }
    }
  }

  if (current !== "") lines.push(current);
  return lines;
}

export function rasterizeText(
  canvas: HTMLCanvasElement,
  text: string,
  style: ResolvedTextStyle,
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
): boolean {
  // 実効 DPR: 辺長が MAX を超えるなら pixelRatio を自動で下げる。
  let effectivePR = pixelRatio;
  const longest = Math.max(cssWidth, cssHeight);
  if (longest * effectivePR > MAX_CANVAS_SIZE && longest > 0) {
    effectivePR = MAX_CANVAS_SIZE / longest;
  }

  canvas.width = Math.min(MAX_CANVAS_SIZE, Math.max(1, Math.ceil(cssWidth * effectivePR)));
  canvas.height = Math.min(MAX_CANVAS_SIZE, Math.max(1, Math.ceil(cssHeight * effectivePR)));

  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  ctx.scale(effectivePR, effectivePR);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  ctx.font = buildFontSpec(style);
  ctx.fillStyle = style.color;
  ctx.textBaseline = "middle";

  const ls = style.letterSpacing;
  // ctx.letterSpacing 対応環境では measureText がスペーシング込みを返すため、
  // 折り返し計測でも手動加算しない。非対応環境では文字数ぶんを加算する。
  const supportsLetterSpacing = ls > 0 && "letterSpacing" in ctx;
  if (supportsLetterSpacing) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${ls}px`;
  }
  const measure = (s: string): number => {
    const w = ctx.measureText(s).width;
    return supportsLetterSpacing || ls === 0 ? w : w + ls * s.length;
  };

  const contentWidth = cssWidth - style.paddingLeft - style.paddingRight;

  let x: number;
  if (style.textAlign === "center") {
    x = style.paddingLeft + contentWidth / 2;
    ctx.textAlign = "center";
  } else if (style.textAlign === "right") {
    x = cssWidth - style.paddingRight;
    ctx.textAlign = "right";
  } else {
    x = style.paddingLeft;
    ctx.textAlign = "left";
  }

  // 明示的な \n は段落区切りとして尊重し、各段落を折り返す。
  // 段落内は連続空白を 1 個の半角スペースへ正規化する（white-space: pre / <br> は非対応）。
  const paragraphs = text.split("\n");
  const lines: string[] = [];
  for (const p of paragraphs) {
    const normalized = p.replace(/\s+/g, " ").trim();
    // 改行位置は DOM に決めさせる。取れない環境だけ自前計測にフォールバックする。
    const wrapped =
      layoutLinesDom(normalized, contentWidth, style) ??
      layoutLines(normalized, contentWidth, measure);
    if (wrapped.length === 0) {
      // 空段落も 1 行分の高さを占める。
      lines.push("");
    } else {
      lines.push(...wrapped);
    }
  }

  const drawLetterSpaced = (s: string, lineY: number): void => {
    // 非対応環境のフォールバック: 1 文字ずつ描画し advance を手動加算する。
    let cursor = x;
    for (const ch of s) {
      ctx.fillText(ch, cursor, lineY);
      cursor += ctx.measureText(ch).width + ls;
    }
  };

  // 縦揃えの基準はコンテンツ領域（要素高さから上下 padding を除いた範囲）。
  // 収まらない場合もクランプせずそのまま描く（CSS の overflow: visible 相当）。
  const contentHeight = cssHeight - style.paddingTop - style.paddingBottom;
  const blockHeight = lines.length * style.lineHeight;
  const slack = contentHeight - blockHeight;
  const startY =
    style.paddingTop +
    (style.verticalAlign === "center"
      ? slack / 2
      : style.verticalAlign === "bottom"
        ? slack
        : 0);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "") continue;
    const lineY = startY + style.lineHeight / 2 + i * style.lineHeight;
    if (ls > 0 && !supportsLetterSpacing) {
      drawLetterSpaced(line, lineY);
    } else {
      ctx.fillText(line, x, lineY);
    }
  }

  return true;
}
