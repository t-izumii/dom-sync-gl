/**
 * example 用の TSL ノードファクトリ集。
 * 旧 GLSL 文字列シェーダーを three/tsl のノード合成で等価に書き換えたもの。
 * ノードグラフは plane / effect の構築時に一度だけ組み立てられ、以後の毎フレーム
 * 更新は uniform ノードの `.value` 差し替えのみで行われる。
 */
import { TSL } from "dom-sync-gl";
import type { EffectContext, PlaneNodeContext } from "dom-sync-gl";
import type { Node, UniformNode, Vector2 } from "three/webgpu";

const {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  fract,
  floor,
  dot,
  mix,
  sin,
  smoothstep,
  distance,
  length,
  clamp,
  pow,
  max,
} = TSL;

// ----------------------------------------------------------------------------
// 共通ノイズ関数。value noise + 6 オクターブ fbm。水墨のにじみに使う。
// Fn でシェーダー関数として共有し、呼び出しごとのノードグラフ肥大を避ける。
// ----------------------------------------------------------------------------
const hash = Fn(([p]: [Node]) => {
  const q = fract(p.mul(vec2(123.34, 456.21)));
  const r = q.add(dot(q, q.add(45.32)));
  return fract(r.x.mul(r.y));
});

const vnoise = Fn(([p]: [Node]) => {
  const i = floor(p);
  const f = fract(p);
  const a = hash(i);
  const b = hash(i.add(vec2(1.0, 0.0)));
  const c = hash(i.add(vec2(0.0, 1.0)));
  const d = hash(i.add(vec2(1.0, 1.0)));
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

const fbm = Fn(([p]: [Node]) => {
  // GLSL 版の for ループ（6 オクターブ）。係数がすべて定数なので JS 側で展開する。
  let v: Node = float(0.0);
  let q: Node = p;
  let amp = 0.5;
  for (let octave = 0; octave < 6; octave++) {
    v = v.add(vnoise(q).mul(amp));
    q = q.mul(2.0);
    amp *= 0.5;
  }
  return v;
});

// ----------------------------------------------------------------------------
// ヒーロー背景。selector=null のフルスクリーン plane の colorNode。
// 和紙の地の上を、ドメインワープした fbm の雲がゆっくり流れる。マウス周辺に
// やわらかな墨だまりがにじむ（uMouseUV はフルスクリーン plane でも hover 経路で更新される）。
// uTime / uResolution / uMouseUV は DomPlane が自動で更新する。uStrength は
// ctx.uniforms 経由で受け取る手動 uniform。
// 全体を淡く保ち、上に乗る墨色のテキストが必ず読めるようにしている。
// ----------------------------------------------------------------------------
export const heroColorNode = (ctx: PlaneNodeContext): Node => {
  const { uTime, uResolution, uMouseUV, uv } = ctx;
  const { uStrength } = ctx.uniforms;

  const p = vec2(uv.x.mul(uResolution.x.div(uResolution.y)), uv.y);
  const t = uTime.mul(0.025);
  const p13 = p.mul(1.3);

  // 2 段のドメインワープで雲のにじみを作る
  const q = vec2(fbm(p13.add(t)), fbm(p13.add(vec2(3.1, 1.7)).sub(t)));
  const r = vec2(
    fbm(p13.add(q.mul(2.2)).add(vec2(1.2, 7.4)).add(t.mul(0.1))),
    fbm(p13.add(q.mul(2.2)).add(vec2(6.1, 2.3)).sub(t.mul(0.08))),
  );
  const f = fbm(p13.add(r.mul(2.2)));

  // マウス周辺にやわらかい墨だまり
  const m = smoothstep(0.5, 0.0, distance(uv, uMouseUV));

  const paper = vec3(0.937, 0.925, 0.894); // 和紙の地
  const ink = vec3(0.6, 0.58, 0.54); // やわらかい墨グレー
  const shu = vec3(0.69, 0.29, 0.19); // 朱（気配だけ）

  // 雲の濃度は淡く保つ（最濃でも paper↔ink の中間どまり）
  const cloud = smoothstep(0.35, 0.95, f);
  let col: Node = mix(paper, ink, cloud.mul(0.5));

  // マウスでにじみを足す
  col = mix(col, ink, m.mul(0.18));

  // ごく僅かに朱の気配（局所・雲の濃いところだけ）
  col = mix(
    col,
    shu,
    clamp(pow(length(r), 2.2).mul(0.1), 0.0, 1.0).mul(cloud.mul(0.7).add(0.3)),
  );

  // スクロール速度で微かに揺らぐ
  col = col.add(sin(uTime.mul(0.5).add(uv.y.mul(7.0))).mul(0.015).mul(uStrength));

  // 紙の縁を僅かに沈めるやわらかいビネット（暗くしすぎない）
  col = col.mul(float(1.0).sub(length(uv.sub(0.5)).mul(0.1)));

  return vec4(col, 1.0);
};

// ----------------------------------------------------------------------------
// Works のビジュアル。各 DOM 要素にロックされる procedural な板。水墨のトーン。
// uColorA(濃い墨) → uColorB(淡いトーン) を fbm の濃度で混ぜる単色ベースの諧調。
// ctx.uniforms 経由で受け取る手動 uniform:
//   uHover   : ホバー量 (0..1, JS 側で lerp)
//   uReveal  : 画面内に入ったときの下からのワイプ (0..~1.2)
//   uStrength: スクロール速度 (0..1)
//   uColorA / uColorB / uSeed: 板ごとの固定値
// ----------------------------------------------------------------------------
export const workColorNode = (ctx: PlaneNodeContext): Node => {
  const { uTime, uResolution, uMouseUV, uv } = ctx;
  const { uHover, uReveal, uStrength, uColorA, uColorB, uSeed } = ctx.uniforms;

  // ホバー時にわずかに寄せて静かな “呼吸” を出す
  const cuv = uv.sub(0.5).mul(float(1.0).sub(uHover.mul(0.05))).add(0.5);
  const scaled = cuv.mul(1.6);
  const p = vec2(scaled.x.mul(uResolution.x.div(uResolution.y)), scaled.y);

  const t = uTime.mul(0.06).add(uSeed.mul(10.0));

  // ホバー位置からのやわらかい波紋
  const d = distance(uv, uMouseUV);
  const ripple = sin(d.mul(14.0).sub(uTime.mul(2.2))).mul(0.5).add(0.5);

  const warp = vec2(fbm(p.add(t)), fbm(p.add(uSeed).sub(t)));
  const n = fbm(p.mul(1.4).add(warp.mul(1.3)).add(uHover.mul(ripple).mul(0.4)));

  // 単色ベースの諧調（濃い墨 → 淡いトーン）
  const shade = smoothstep(0.05, 0.95, n);
  let col: Node = mix(uColorA, uColorB, shade);

  // 墨のにじみ筋をほんの少し
  const veins = smoothstep(0.45, 0.5, fbm(p.mul(2.2).add(warp)));
  col = mix(col, uColorA, veins.mul(0.12));

  // ホバーでわずかに持ち上げる
  col = mix(col, col.mul(1.08).add(0.02), uHover.mul(0.4));

  // スクロール速度でうっすら流す
  col = col.add(uStrength.mul(0.05));

  // 細かい紙の粒子感
  const g = hash(uv.mul(uResolution).add(uTime));
  col = col.add(g.sub(0.5).mul(0.025));

  // 下からのリビールワイプ
  const reveal = smoothstep(uv.y, uv.y.add(0.16), uReveal.mul(1.2));

  return vec4(col, reveal);
};

// ----------------------------------------------------------------------------
// DomTextPlane 用の plane effect。plane.addEffect() 経由で PlaneComposer に繋がるので、
// ctx.inputTexture には「その板だけを描いたテクスチャ」（＝ラスタライズ済みテキスト）が入る。
// uHover は main 側で lerp した値を setHover() で流し込む。
// 文字の alpha は 3 サンプルの最大値で保ち、色だけを左右にずらして滲みを出す。
// ----------------------------------------------------------------------------
export const textHoverNode = (
  ctx: EffectContext,
  uHover: UniformNode<number>,
): Node => {
  const off = uHover.mul(0.008);
  const r = ctx.inputTexture.sample(ctx.uv.add(vec2(off, 0.0)));
  const g = ctx.inputTexture.sample(ctx.uv);
  const b = ctx.inputTexture.sample(ctx.uv.sub(vec2(off, 0.0)));
  const a = max(max(r.a, g.a), b.a);
  return vec4(r.r, g.g, b.b, a);
};

// ----------------------------------------------------------------------------
// フルスクリーン post effect。光の地に合わせて極めて控えめに仕上げる。
// スクロール中だけ僅かな色収差、淡いフィルムグレイン、やわらかいビネット。
// （ダーク版の強い収差 / 走査線 / 濃いビネットは紙の地に合わないため外した）
// 前段パスの出力は ctx.inputTexture として EffectComposer が自動注入する。
// ----------------------------------------------------------------------------
export const filmNode = (
  ctx: EffectContext,
  u: {
    uTime: UniformNode<number>;
    uResolution: UniformNode<Vector2>;
    uStrength: UniformNode<number>;
  },
): Node => {
  const dir = ctx.uv.sub(0.5);

  // スクロール中だけ、中心から離れるほど僅かに色収差
  const aberr = u.uStrength.mul(0.004).add(0.0002).mul(dot(dir, dir)).mul(4.0);
  const off = dir.mul(aberr);
  const r = ctx.inputTexture.sample(ctx.uv.add(off)).r;
  const g = ctx.inputTexture.sample(ctx.uv).g;
  const b = ctx.inputTexture.sample(ctx.uv.sub(off)).b;
  let col: Node = vec3(r, g, b);

  // 淡いフィルムグレイン（紙の粒子感）
  const grain = fract(
    sin(dot(ctx.uv.mul(u.uResolution).add(u.uTime), vec2(12.9898, 78.233))).mul(
      43758.5453,
    ),
  );
  col = col.add(grain.sub(0.5).mul(0.02));

  // 紙の縁をほんの少し沈めるやわらかいビネット
  col = col.mul(float(1.0).sub(dot(dir, dir).mul(0.1)));

  return vec4(col, 1.0);
};
