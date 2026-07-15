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
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
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

  const resolved: ResolvedTextStyle = {
    fontSize,
    fontFamily: cs.fontFamily || "sans-serif",
    fontWeight: cs.fontWeight || "400",
    fontStyle: cs.fontStyle || "normal",
    color: cs.color || "rgb(0, 0, 0)",
    lineHeight,
    letterSpacing,
    textAlign,
    paddingTop: num(cs.paddingTop),
    paddingRight: num(cs.paddingRight),
    paddingBottom: num(cs.paddingBottom),
    paddingLeft: num(cs.paddingLeft),
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
  }

  return resolved;
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
    const wrapped = layoutLines(normalized, contentWidth, measure);
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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "") continue;
    const lineY = style.paddingTop + style.lineHeight / 2 + i * style.lineHeight;
    if (ls > 0 && !supportsLetterSpacing) {
      drawLetterSpaced(line, lineY);
    } else {
      ctx.fillText(line, x, lineY);
    }
  }

  return true;
}
