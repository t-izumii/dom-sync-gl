/**
 * 展示作品 5 点のプロシージャルな作品シェーダーと、共通の額装（リビール・
 * ホバーのレンズ・スクロール速度での湾曲）。
 *
 * 作品関数は「アスペクト補正済み・中心原点の座標 p」を受け取って色を返すだけにし、
 * リビールやホバー、グレインといった展示の振る舞いは frameNode に一本化している。
 * 反復はすべて JS 側で展開した固定回数（最大 9 セル / 4 反復）に抑える。
 */
import { TSL } from "dom-sync-gl";
import type { PlaneNodeContext } from "dom-sync-gl";
import type { Node, UniformNode } from "three/webgpu";
import { hash21, hash22, makeFbm, spectrum, vnoise } from "./noise";
import { shared } from "../uniforms";

const {
  float,
  vec2,
  vec3,
  vec4,
  sin,
  cos,
  abs,
  exp,
  pow,
  mix,
  min,
  max,
  dot,
  length,
  floor,
  fract,
  smoothstep,
  clamp,
  positionLocal,
} = TSL;

/** 作品関数の入力 */
export interface ArtInput {
  /** アスペクト補正済み・中心原点の座標（縦 -0.5..0.5） */
  p: Node;
  /** 演出用の時間（秒） */
  t: Node;
  /** ポインタ位置（p と同じ座標系） */
  m: Node;
  /** ホバー量 0..1 */
  hover: Node;
}

export type ArtFn = (a: ArtInput, octaves: number) => Node;

// ----------------------------------------------------------------------------
// E—01 Caustic Floor — 水底に揺れる焦線（コースティクス）
// 反復的な座標ワープで光の網目を作る古典的な手法を 4 反復に展開したもの。
// ----------------------------------------------------------------------------
const caustic: ArtFn = ({ p, t, m, hover }) => {
  // ポインタの近くで水面が少し盛り上がり、網目が寄る
  const dm = p.sub(m);
  const bump = exp(dot(dm, dm).mul(-10.0)).mul(hover).mul(0.25);
  // 元の手法は大きな負のオフセット上で反復する（原点付近だと 1/length が発散して白飛びする）
  const base = p.mul(5.5).add(dm.mul(bump)).sub(250.0);
  let i: Node = base;
  let c: Node = float(1.0);
  const inten = 0.006;
  const tt = t.mul(0.35).add(23.0);
  for (let n = 0; n < 4; n++) {
    const t2 = tt.mul(1.0 - 3.5 / (n + 1));
    i = base.add(
      vec2(cos(t2.sub(i.x)).add(sin(t2.add(i.y))), sin(t2.sub(i.y)).add(cos(t2.add(i.x)))),
    );
    const denom = vec2(
      base.x.div(sin(i.x.add(t2)).div(inten)),
      base.y.div(cos(i.y.add(t2)).div(inten)),
    );
    c = c.add(float(1.0).div(max(length(denom), 0.001)));
  }
  c = c.div(4.0);
  c = float(1.17).sub(pow(abs(c), 1.4));
  const lines = pow(abs(c), 7.0).clamp(0.0, 1.5);

  // 深い青緑の地に、金の焦線。上ほど水面に近く明るい
  const depth = smoothstep(-0.6, 0.6, p.y);
  let col: Node = mix(vec3(0.01, 0.05, 0.07), vec3(0.03, 0.16, 0.19), depth);
  col = col.add(mix(vec3(1.0, 0.62, 0.28), vec3(1.0, 0.93, 0.78), lines.mul(0.5)).mul(lines).mul(0.9));
  col = col.add(shared.uCounter.mul(lines).mul(0.12));
  return col;
};

// ----------------------------------------------------------------------------
// E—02 Aurora Curtain — 極光の緞帳
// 横方向に揺らいだ縦縞を 3 層重ね、下端をノイズで揺らしてカーテンにする。
// ----------------------------------------------------------------------------
const aurora: ArtFn = ({ p, t, m, hover }, octaves) => {
  const fbm = makeFbm(Math.max(2, octaves - 1));
  let col: Node = mix(vec3(0.005, 0.01, 0.03), vec3(0.02, 0.03, 0.07), p.y.add(0.5));
  // 星（静かな粒）
  const star = smoothstep(0.985, 1.0, hash21(floor(p.mul(180.0))));
  col = col.add(vec3(0.7, 0.8, 1.0).mul(star).mul(0.5).mul(smoothstep(-0.1, 0.5, p.y)));

  const layers: [number, number, [number, number, number]][] = [
    [1.0, 0.0, [0.35, 1.0, 0.8]],
    [1.6, 3.1, [0.4, 0.8, 1.0]],
    [2.3, 7.7, [1.0, 0.55, 0.35]],
  ];
  // ポインタで緞帳がそよぐ
  const sway = sin(p.y.mul(3.0).add(t)).mul(m.x.sub(p.x).mul(hover).mul(0.15));
  for (const [freq, seed, tint] of layers) {
    const x = p.x.add(sway);
    const warp = fbm(vec2(x.mul(1.2).add(seed), t.mul(0.08).add(seed)));
    // 底は理論上 0..1 だが、丸めで僅かに負になっても pow が未定義にならないよう max で守る
    const band = pow(max(sin(x.mul(freq * 7.0).add(warp.mul(6.0)).add(t.mul(0.3))).mul(0.5).add(0.5), 0.0), 5.0);
    // 下端（光の裾）はノイズで上下させ、上に向かって薄くする
    const hem = warp.mul(0.5).sub(0.35).add(seed * 0.01);
    const vertical = smoothstep(hem, hem.add(0.04), p.y).mul(exp(p.y.sub(hem).mul(-3.2)));
    col = col.add(vec3(...tint).mul(band).mul(vertical).mul(0.75 / freq + 0.2));
  }
  return col;
};

// ----------------------------------------------------------------------------
// E—03 Moiré Interference — 干渉縞
// 2 組の同心円の積で干渉縞を作る。片方の中心がポインタへ引かれ、縞が走る。
// ----------------------------------------------------------------------------
const moire: ArtFn = ({ p, t, m, hover }) => {
  const c1 = vec2(sin(t.mul(0.21)).mul(0.12), cos(t.mul(0.17)).mul(0.08));
  const c2home = vec2(cos(t.mul(0.13)).mul(0.18), sin(t.mul(0.19)).mul(0.12));
  const c2 = mix(c2home, m, hover.mul(0.8));
  const r1 = sin(length(p.sub(c1)).mul(170.0));
  const r2 = sin(length(p.sub(c2)).mul(170.0));
  const inter = r1.mul(r2);
  // 細い線として拾う（線幅は 1px 付近に保つ）
  const fine = smoothstep(0.55, 0.95, inter);
  // 干渉の包絡（大きなうねり）で色を振る
  const env = sin(length(p.sub(c1)).sub(length(p.sub(c2))).mul(170.0)).mul(0.5).add(0.5);
  const warm = vec3(1.0, 0.7, 0.4);
  const cool = shared.uCounter;
  let col: Node = mix(cool, warm, env).mul(fine).mul(0.85);
  col = col.add(vec3(0.02, 0.02, 0.03));
  // 周辺を落として円形の光だまりに
  col = col.mul(smoothstep(0.75, 0.05, length(p)));
  return col;
};

// ----------------------------------------------------------------------------
// E—04 Ink in Water — 水中の墨（光の墨）
// 2 段のドメインワープで、光を含んだインクが水中でほどける様子。
// ----------------------------------------------------------------------------
const ink: ArtFn = ({ p, t, m, hover }, octaves) => {
  const fbm = makeFbm(octaves);
  const tt = t.mul(0.06);
  const dm = p.sub(m);
  const push = dm.mul(exp(dot(dm, dm).mul(-12.0)).mul(hover).mul(0.6));
  const s = p.mul(2.2).add(push);
  const q = vec2(fbm(s.add(vec2(0.0, tt))), fbm(s.add(vec2(5.2, 1.3).sub(tt))));
  const f = fbm(s.add(q.mul(2.4)).add(vec2(tt.mul(1.4), 0.0)));
  const density = smoothstep(0.3, 0.85, f);
  // 等値線の近くを明るく縁取る（インクの輪郭が光る）
  const rim = exp(abs(f.sub(0.55)).mul(-38.0));
  let col: Node = mix(vec3(0.015, 0.01, 0.012), vec3(0.45, 0.07, 0.03), density);
  col = mix(col, vec3(1.0, 0.45, 0.12), pow(density, 3.0));
  col = col.add(vec3(1.0, 0.82, 0.55).mul(rim).mul(0.55));
  col = col.add(shared.uCounter.mul(q.y.mul(q.y)).mul(0.08));
  return col;
};

// ----------------------------------------------------------------------------
// E—05 Prismatic Crystal — 分光する結晶
// 3×3 セルのボロノイで面を作り、面ごとの傾きから分光色を決める。
// 光の帯が斜めに通り過ぎ、ポインタ付近の面が強く輝く。
// ----------------------------------------------------------------------------
const prism: ArtFn = ({ p, t, m, hover }) => {
  const s = p.mul(4.2);
  const cell = floor(s);
  const local = fract(s);
  let minD: Node = float(8.0);
  let second: Node = float(8.0);
  let id: Node = vec2(0.0);
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      const o = vec2(x, y);
      const h = hash22(cell.add(o));
      const pt = o.add(h.mul(0.5).add(0.25)).add(sin(t.mul(0.3).add(h.mul(6.28))).mul(0.08));
      const d = length(pt.sub(local));
      // 1 位 / 2 位の距離を保持（境界の稜線に使う）
      const isNear = d.lessThan(minD);
      second = TSL.select(isNear, minD, min(second, d));
      id = TSL.select(isNear, cell.add(o), id);
      minD = TSL.select(isNear, d, minD);
    }
  }
  const edge = smoothstep(0.0, 0.06, second.sub(minD));
  const facet = hash21(id);
  // 斜めに通り過ぎる光の帯
  // pow() は負の底で未定義（GLSL / WGSL とも）なので、2 乗は自乗で書く
  const sweepD = p.x.add(p.y.mul(0.6)).sub(sin(t.mul(0.25)).mul(0.7));
  const sweep = exp(sweepD.mul(sweepD).mul(-18.0));
  const dm = length(p.sub(m));
  const glint = exp(dm.mul(dm).mul(-30.0)).mul(hover);
  const hue = facet.add(p.x.mul(0.4)).add(t.mul(0.03));
  const disp = spectrum(hue);
  // 面は暗いガラス（面ごとに明度だけ変える）。分光色は光の帯・ポインタ・稜線の近くにだけ出す
  const glass = mix(vec3(0.012, 0.014, 0.022), vec3(0.05, 0.055, 0.075), facet);
  const light = sweep.add(glint).mul(facet.mul(0.7).add(0.3));
  let col: Node = glass.add(disp.mul(light).mul(0.75));
  // 稜線の内側で色が割れる（プリズムの縁）
  const rim = smoothstep(0.08, 0.0, second.sub(minD));
  col = col.add(disp.mul(rim).mul(sweep.mul(0.8).add(0.035)));
  // 稜線そのものは白く細く
  col = mix(vec3(1.0, 0.95, 0.88).mul(sweep.mul(0.9).add(0.18)), col, edge);
  return col;
};

export const ARTS: Record<string, ArtFn> = { caustic, aurora, moire, ink, prism };

/** frameNode が受け取る作品ごとの uniform */
export interface FrameUniforms {
  uReveal: UniformNode<number>;
  uHover: UniformNode<number>;
  uSeed: UniformNode<number>;
}

/**
 * 作品を額装する colorNode。
 * - ホバー: ポインタ位置を中心にした拡大レンズ（uMouseUV は PointerController が raycast で更新）
 * - リビール: 斜めのノイズ境界で下から拭き取り、境界にハレーション色の光の縁
 * - 仕上げ: 額縁内のビネット（グレインは全画面の仕上げパスでまとめて乗せる）
 */
export const createFrameNode =
  (art: ArtFn, octaves: number) =>
  (ctx: PlaneNodeContext): Node => {
    const { uv, uResolution, uMouseUV } = ctx;
    const { uReveal, uHover, uSeed } = ctx.uniforms as unknown as FrameUniforms;
    const aspect = uResolution.x.div(max(uResolution.y, 1.0));
    const toP = (q: Node) => vec2(q.x.sub(0.5).mul(aspect), q.y.sub(0.5));

    // ホバーのレンズ（中心ほど拡大）
    const dUv = uv.sub(uMouseUV);
    const dLens = vec2(dUv.x.mul(aspect), dUv.y);
    const lens = exp(dot(dLens, dLens).mul(-14.0)).mul(uHover);
    const luv = uv.sub(dUv.mul(lens.mul(0.28)));

    const t = shared.uClock.add(uSeed.mul(17.0));
    const col0 = art({ p: toP(luv), t, m: toP(uMouseUV), hover: uHover }, octaves);

    // 額縁内のビネット
    const e = uv.sub(0.5);
    let col: Node = col0.mul(float(1.0).sub(dot(e, e).mul(0.9)));
    // レンズの縁にごく薄いシアンのフリンジ
    col = col.add(shared.uCounter.mul(lens.mul(float(1.0).sub(lens)).mul(0.25)));

    // リビール: 斜めの境界 + ノイズのぎざぎざ
    const n = vnoise(uv.mul(vec2(6.0, 3.0)).add(uSeed.mul(9.0))).mul(0.12);
    const w = uv.y.mul(0.75).add(uv.x.mul(0.25)).add(n);
    const r = uReveal.mul(1.25).sub(0.05);
    const mask = smoothstep(w.sub(0.015), w, r);
    const edge = exp(abs(w.sub(r)).mul(-55.0)).mul(float(1.0).sub(smoothstep(0.95, 1.0, uReveal)));
    col = col.add(mix(shared.uKeyA, shared.uKeyB, 0.4).mul(edge).mul(1.4));

    return vec4(col, clamp(mask.add(edge), 0.0, 1.0));
  };

/**
 * スクロール速度で板をしならせる positionNode。
 * 横スクロールのギャラリーで、進行方向に向かって円筒状に反り、わずかにせん断する。
 * positionLocal は -0.5..0.5 の正規化座標で、z は mesh.scale.z = 1 のため px 単位になる。
 */
export const bendPositionNode = (ctx: PlaneNodeContext): Node => {
  const { uVelocity } = shared;
  const { uHover } = ctx.uniforms as unknown as FrameUniforms;
  const pos = positionLocal;
  const x2 = pos.x.mul(2.0);
  const arch = float(1.0).sub(x2.mul(x2));
  const z = arch.mul(abs(uVelocity)).mul(90.0).add(arch.mul(uHover).mul(14.0));
  const shear = pos.x.mul(uVelocity).mul(0.06);
  return vec3(pos.x, pos.y.add(shear), z);
};
