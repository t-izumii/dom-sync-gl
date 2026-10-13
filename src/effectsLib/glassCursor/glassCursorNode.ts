/**
 * グラスカーソルの合成ノード。寸法はすべて CSS px・左上原点で扱う。
 *
 * 移植元は DOM + SVG フィルタ（`backdrop-filter: url(#filter) blur() ...`）
 * なので、ブラウザと同じく sRGB の straight alpha でフィルタと重ね合わせを
 * 行い、最後に linear の premultiplied alpha へ戻す。linear のまま重ねると
 * 白いリングが原典より明るく太って見える。
 *
 * @see ./glassCursorEffect.ts
 */
import type { Node } from 'three/webgpu';
import {
  abs,
  clamp,
  cos,
  dot,
  float,
  length,
  max,
  min,
  mix,
  screenSize,
  select,
  sin,
  smoothstep,
  sRGBTransferEOTF,
  sRGBTransferOETF,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { EffectContext } from '../../index';

/** 移植元のガラス直径（CSS px）。リングと星の寸法はこれを基準に比例させる */
export const BASE_SIZE = 48;

/** 星（18x18 の SVG）は 1 マス 2.515625 の 7x7 ドット絵 */
const STAR_UNIT = 2.515625;

/**
 * 屈折量の上限（ガラス直径に対する比）。移植元は歪みマップを最大変位の
 * 半分で正規化して 0〜1 に詰めるため、はみ出た分が切り捨てられて実効の
 * 上限は最大変位の 1/4 になる。最大変位はマップの角 (-0.5, -0.5) で取る。
 * 縁の屈折が約 3 割弱まるので、見た目を合わせるために同じ上限で clamp する。
 */
const MAX_SHIFT_RATIO = (() => {
  const s = (t: number) => t * t * (3 - 2 * t);
  const sdf = Math.hypot(0.5 - 0.3 + 0.6, 0.5 - 0.2 + 0.6) - 0.6;
  const amount = s(s(Math.min(Math.max((sdf - 0.7) / -0.6, 0), 1)));
  return 0.25 * 0.5 * (1 - amount);
})();

export interface GlassCursorNodeUniforms {
  /** 描画領域の CSS px サイズ */
  uViewport: Node;
  /** カーソル中心（CSS px・左上原点） */
  uCenter: Node;
  /** ガラス直径（CSS px） */
  uSize: Node;
  uScale: Node;
  uOpacity: Node;
  uRefraction: Node;
  uBlur: Node;
  uContrast: Node;
  uBrightness: Node;
  uSaturate: Node;
  uRingOpacity: Node;
  /** 内側リングの回転角（rad・時計回り） */
  uAngle: Node;
  uStarOpacity: Node;
}

/** 角丸矩形の符号付き距離。移植元 `roundedRectSDF` と同じ式 */
const roundedRectSDF = (p: Node, half: Node, radius: number): Node => {
  const d = abs(p).sub(half).add(radius);
  return min(max(d.x, d.y), 0).add(length(max(d, 0))).sub(radius);
};

const boxSDF = (p: Node, center: Node, half: Node): Node => {
  const d = abs(p.sub(center)).sub(half);
  return length(max(d, 0)).add(min(max(d.x, d.y), 0));
};

/**
 * 移植元の歪みマップの倍率。中心 1 → 縁で 0 に近づき、縁ほど中心寄りを
 * 読む（縁が引き伸ばされて見える）。`smoothstep(0.6, 0, x)` は端点が逆順で
 * GLSL では未定義なので、JS 版と同じく式を展開して書く。
 */
const lensAmount = (sdf: Node): Node => {
  const t = clamp(sdf.sub(0.1).sub(0.6).div(-0.6), 0, 1);
  return smoothstep(0, 1, t.mul(t).mul(float(3).sub(t.mul(2))));
};

/** sRGB の straight 色 `c`・不透明度 `a` を premultiplied で `dst` の上に重ねる */
const over = (dst: Node, c: Node, a: Node): Node =>
  vec4(c.mul(a).add(dst.rgb.mul(float(1).sub(a))), a.add(dst.a.mul(float(1).sub(a))));

const toStraightSRGB = (premulLinear: Node): Node =>
  sRGBTransferOETF(premulLinear.rgb.div(max(premulLinear.a, 1e-5)));

export const glassCursorNode = (
  ctx: EffectContext,
  u: GlassCursorNodeUniforms,
): Node => {
  const base = ctx.inputTexture;
  const p = ctx.uv.mul(u.uViewport);
  const dpr = screenSize.y.div(u.uViewport.y);

  // ラッパー基準・ホバー拡縮前の座標。移植元の寸法はこの空間で決まっている
  const local = p.sub(u.uCenter).div(u.uScale);
  const r = length(local);
  const k = u.uSize.div(BASE_SIZE);
  // 1 物理 px をこの空間の長さに直したもの。fwidth を使わず解析的に AA する
  const px = float(1).div(dpr.mul(u.uScale));
  const coverage = (d: Node): Node => clamp(float(0.5).sub(d.div(px)), 0, 1);

  /* ==---- ガラス本体 ---- */

  const maxShift = u.uSize.mul(MAX_SHIFT_RATIO);
  /** 画面上の点 q（CSS px）がガラス越しに読む背景の位置 */
  const refract = (q: Node): Node => {
    // 移植元の歪みマップは画素 i に座標 i/size の値を焼くため、補間された場は
    // 半画素（0.5px）ずれている
    const lensUv = q.sub(u.uCenter).div(u.uScale).sub(0.5).div(u.uSize);
    const amount = lensAmount(roundedRectSDF(lensUv, vec2(0.3, 0.2), 0.6));
    const shift = clamp(lensUv.mul(amount.sub(1)).mul(u.uSize), maxShift.negate(), maxShift);
    return q.add(shift.mul(u.uRefraction).mul(u.uScale));
  };

  // CSS の blur(σ) を二項 3x3 カーネルで近似する。分散が 0.5·s² なので
  // 間隔 s = √2·σ で並べると σ が一致する。移植元は屈折後の画像をぼかすため、
  // タップごとに屈折をやり直す。縁では背景が強く圧縮されるので、屈折先の
  // 周りを読むとぼかしが広がりすぎる
  const step = u.uBlur.mul(Math.SQRT2).mul(u.uScale);
  let blurred: Node = vec4(0);
  for (const [ox, oy, w] of [
    [-1, -1, 1], [0, -1, 2], [1, -1, 1],
    [-1, 0, 2], [0, 0, 4], [1, 0, 2],
    [-1, 1, 1], [0, 1, 2], [1, 1, 1],
  ] as const) {
    const tapPx = refract(p.add(vec2(ox, oy).mul(step)));
    const tap = base.sample(clamp(tapPx.div(u.uViewport), 0, 1));
    blurred = blurred.add(tap.mul(w / 16));
  }

  // contrast → brightness → saturate の順は移植元の backdrop-filter と同じ。
  // 各段で clamp するのは CSS フィルタ（feComponentTransfer 相当）の挙動
  let glass: Node = toStraightSRGB(blurred);
  glass = clamp(glass.sub(0.5).mul(u.uContrast).add(0.5), 0, 1);
  glass = clamp(glass.mul(u.uBrightness), 0, 1);
  const luma = dot(glass, vec3(0.213, 0.715, 0.072));
  glass = clamp(mix(vec3(luma), glass, u.uSaturate), 0, 1);

  /* ==---- 重ね合わせ（下から: 背景 → 外周リング → ガラス → 内側リング → 星） ---- */

  const white = vec3(1);
  const baseColor = toStraightSRGB(base);
  let out: Node = vec4(baseColor.mul(base.a), base.a);

  // 外周リング: 64px の円に 1px の border
  const outerRadius = k.mul(32);
  const outerDist = max(r.sub(outerRadius), outerRadius.sub(1).sub(r));
  out = over(out, white, u.uRingOpacity.mul(coverage(outerDist)).mul(u.uOpacity));

  // ガラス: フィルタ結果で背景を置き換え、要素背景の rgba(255,255,255,0.01) を重ねる
  const glassMask = coverage(r.sub(u.uSize.mul(0.5))).mul(u.uOpacity);
  out = mix(out, vec4(glass.mul(blurred.a), blurred.a), glassMask);
  out = over(out, white, glassMask.mul(0.01));

  // 内側リング: cursor_border.svg（49x49・中心 (25,24)・r=23）を 4 秒で 1 回転。
  // 2 本のストロークに左上と右下から入る線形グラデーションが掛かっている
  const ca = cos(u.uAngle);
  const sa = sin(u.uAngle);
  const rotated = vec2(
    ca.mul(local.x).add(sa.mul(local.y)),
    sa.negate().mul(local.x).add(ca.mul(local.y)),
  );
  const ringSvg = rotated.div(k).add(24.5);
  const ringDist = abs(length(ringSvg.sub(vec2(25, 24))).sub(23)).sub(0.5).mul(k);
  const fadeOut = float(1).sub(
    clamp(dot(ringSvg.sub(vec2(11.5, 7)), vec2(9.5, 13.5)).div(272.5), 0, 1),
  );
  const fadeIn = clamp(dot(ringSvg.sub(vec2(37, 32.5)), vec2(12, 19)).div(505), 0, 1);
  const ringAlpha = fadeIn.add(fadeOut.mul(float(1).sub(fadeIn)));
  out = over(out, white, ringAlpha.mul(coverage(ringDist)).mul(u.uOpacity));

  // 星: 中心が抜けた 8 方向のドット絵。上下左右の棒と斜めの 4 マスに分け、
  // 中心で折り返して 3 つの矩形の和で表す
  const starSvg = local.div(k).add(9);
  const folded = abs(starSvg.sub(STAR_UNIT * 3.5));
  const starDist = min(
    min(
      boxSDF(folded, vec2(0, STAR_UNIT * 2.5), vec2(STAR_UNIT * 0.5, STAR_UNIT)),
      boxSDF(folded, vec2(STAR_UNIT * 2.5, 0), vec2(STAR_UNIT, STAR_UNIT * 0.5)),
    ),
    boxSDF(folded, vec2(STAR_UNIT), vec2(STAR_UNIT * 0.5)),
  ).mul(k);
  out = over(out, white, u.uStarOpacity.mul(coverage(starDist)).mul(u.uOpacity));

  const outLinear = vec4(
    sRGBTransferEOTF(out.rgb.div(max(out.a, 1e-5))).mul(out.a),
    out.a,
  );
  // カーソルの外は入力をそのまま返し、sRGB 往復の誤差も持ち込まない
  return select(r.lessThan(outerRadius.add(2)), outLinear, base);
};
