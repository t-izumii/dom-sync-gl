/**
 * ディザカーソルの TSL ノードファクトリ集。
 * 旧 GLSL 2 パス（sim / display）を three/tsl のノード合成で等価に書き換えたもの。
 * ノードグラフは effect の構築時に一度だけ組み立てられ、以後の毎フレーム更新は
 * uniform / texture ノードの `.value` 差し替えのみで行われる。
 */
import type {
  Color,
  Node,
  TextureNode,
  UniformNode,
  Vector2,
} from 'three/webgpu';
import {
  Fn,
  abs,
  dot,
  exp,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  pow,
  screenCoordinate,
  select,
  smoothstep,
  step,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { EffectContext } from '../../index';

// ----------------------------------------------------------------------------
// 2D simplex noise（Ashima Arts / Ian McEwan の定番実装。MIT）の TSL 移植。
// mod289 / permute は snoise の Fn 本体内でしか使わないため、Fn にせず
// プレーンなノード式ヘルパーとして展開する（snoise 本体は Fn で共有され、
// 呼び出しごとのノードグラフ肥大は起きない）。
// ----------------------------------------------------------------------------
const mod289 = (x: Node): Node => x.sub(floor(x.mul(1 / 289)).mul(289));
const permute = (x: Node): Node => mod289(x.mul(34).add(1).mul(x));

const snoise = Fn(([v]: [Node]) => {
  // const vec4 C = vec4(0.211324865405187, 0.366025403784439,
  //                     -0.577350269189626, 0.024390243902439);
  const Cx = 0.211324865405187;
  const Cy = 0.366025403784439;
  const Cz = -0.577350269189626;
  const Cw = 0.024390243902439;

  const cell = floor(v.add(dot(v, vec2(Cy, Cy))));
  const x0 = v.sub(cell).add(dot(cell, vec2(Cx, Cx)));
  const i1 = select(x0.x.greaterThan(x0.y), vec2(1, 0), vec2(0, 1));
  // GLSL: vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
  // ここでは xy / zw を分けて保持する（swizzle 再代入を避ける）
  const x12xy = x0.add(Cx).sub(i1);
  const x12zw = x0.add(Cz);
  const i = mod289(cell);
  const p = permute(
    permute(i.y.add(vec3(0, i1.y, 1)))
      .add(i.x)
      .add(vec3(0, i1.x, 1)),
  );
  let m: Node = max(
    vec3(0.5).sub(vec3(dot(x0, x0), dot(x12xy, x12xy), dot(x12zw, x12zw))),
    0.0,
  );
  m = m.mul(m);
  m = m.mul(m);
  const x = fract(p.mul(Cw)).mul(2).sub(1);
  const h = abs(x).sub(0.5);
  const ox = floor(x.add(0.5));
  const a0 = x.sub(ox);
  m = m.mul(
    a0.mul(a0).add(h.mul(h)).mul(-0.85373472095314).add(1.79284291400159),
  );
  // GLSL: g.x = a0.x*x0.x + h.x*x0.y; g.yz = a0.yz*x12.xz + h.yz*x12.yw;
  const g = vec3(
    a0.x.mul(x0.x).add(h.x.mul(x0.y)),
    a0.y.mul(x12xy.x).add(h.y.mul(x12xy.y)),
    a0.z.mul(x12zw.x).add(h.z.mul(x12zw.y)),
  );
  return dot(m, g).mul(130);
});

// snoise のポテンシャル場から curl（非圧縮な渦速度場）を数値微分で得る
const curlNoise = Fn(([p]: [Node]) => {
  const eps = 0.1;
  const dy = snoise(p.add(vec2(0, eps)))
    .sub(snoise(p.sub(vec2(0, eps))))
    .div(2 * eps);
  const dx = snoise(p.add(vec2(eps, 0)))
    .sub(snoise(p.sub(vec2(eps, 0))))
    .div(2 * eps);
  return vec2(dy, dx.negate());
});

// ----------------------------------------------------------------------------
// シミュレーションパス（HalfFloat ping-pong / GPGPU compute 型）。
// R チャンネル 1 本の「インク濃度場」を毎フレーム更新する:
//   1) curl noise で読み出し UV をずらす移流（semi-Lagrangian の最簡形）
//   2) 上下左右 + 自身の 5 タップ平均で拡散（にじみ）
//   3) マウス位置に Gaussian ブラシで注入（速度ゲート付き。静止時は溜まらない）
//   4) 定数引き算の線形減衰（尾の端がきっぱり消える。指数減衰だと薄い残像が漂う）
// ----------------------------------------------------------------------------
export interface DitherSimNodes {
  /** 前フレームの濃度場を読む texture ノード */
  uPrev: TextureNode;
  /** sim RT の解像度（drawing buffer と同じ） */
  uResolution: UniformNode<Vector2>;
  uTime: UniformNode<number>;
  uMouse: UniformNode<Vector2>;
  /** JS 側で lerp 平滑化済みのマウス速度（UV 距離/フレーム） */
  uSpeed: UniformNode<number>;
  uRadius: UniformNode<number>;
  uDecay: UniformNode<number>;
  uIntensity: UniformNode<number>;
}

export const ditherSimNode = (n: DitherSimNodes): Node => {
  const vUv = uv();
  const texel = vec2(1).div(n.uResolution);

  // 1) 移流: 場のグリッドは固定のまま、読む場所だけを curl noise 方向へ少しずらす
  const velocity = curlNoise(vUv.mul(0.5).add(n.uTime.mul(0.1)));
  const advectedUv = vUv.sub(velocity.mul(0.001));

  // 2) 拡散: 移流先を中心に上下左右 + 自身の 5 点平均
  const c = n.uPrev.sample(advectedUv).r;
  const t = n.uPrev.sample(advectedUv.add(vec2(0, texel.y))).r;
  const b = n.uPrev.sample(advectedUv.sub(vec2(0, texel.y))).r;
  const l = n.uPrev.sample(advectedUv.sub(vec2(texel.x, 0))).r;
  const r = n.uPrev.sample(advectedUv.add(vec2(texel.x, 0))).r;
  const diffused = c.add(t).add(b).add(l).add(r).div(5);

  // 3) 注入: アスペクト補正した距離の Gaussian ブラシ。
  //    速度ゲート（JS 側で lerp 平滑化済みの uSpeed）で静止時のインク溜まりを防ぐ
  const aspect = n.uResolution.x.div(n.uResolution.y);
  const dist = length(vUv.sub(n.uMouse).mul(vec2(aspect, 1)));
  const brush = exp(pow(dist.div(n.uRadius), 2).negate())
    .mul(n.uIntensity)
    .mul(smoothstep(0.0, 0.01, n.uSpeed))
    .mul(0.5);

  // 4) 上限クランプ → 線形減衰 → 0 で床
  const value = min(diffused.add(brush), 0.95).sub(n.uDecay);
  return vec4(vec3(max(value, 0.0)), 1);
};

// ----------------------------------------------------------------------------
// 表示パス。シミュレーションの濃度場（R チャンネル）を pow で整形し、
// Bayer 8x8 ordered dithering の閾値で 2 値化して前段パスの結果に合成する。
// 閾値は screenCoordinate（physical px）基準なので、画面サイズが変わっても
// ドットの物理サイズは uDitherSize px で一定。
// ----------------------------------------------------------------------------

// 再帰的 Bayer 行列の手続き生成（2x2 → 4x4 → 8x8）。値域 [0, 1)。
// 64 要素テーブルを持たず、1 レベルごとに 1/4 スケールで足し込む定番の構成。
const bayer2 = (p: Node): Node => {
  const q = floor(p);
  return fract(q.x.mul(0.5).add(q.y.mul(q.y).mul(0.75)));
};

const bayer8 = (p: Node): Node =>
  bayer2(p.mul(0.25))
    .mul(0.0625)
    .add(bayer2(p.mul(0.5)).mul(0.25))
    .add(bayer2(p));

export interface DitherDisplayNodes {
  /** シミュレーション結果（ping-pong の読み取り側）を読む texture ノード */
  tSimulation: TextureNode;
  uDitherSize: UniformNode<number>;
  uExponent: UniformNode<number>;
  uColor: UniformNode<Color>;
}

export const ditherDisplayNode = (
  ctx: EffectContext,
  n: DitherDisplayNodes,
): Node => {
  const base = ctx.inputTexture;

  const signal = pow(n.tSimulation.r, n.uExponent);

  const threshold = bayer8(screenCoordinate.div(n.uDitherSize));

  // step(0.0, 0.0) = 1.0 になるため、ほぼゼロの領域にゴマ状ノイズが
  // 出ないよう 0.01 で床切りする
  const on = step(threshold, signal).mul(step(0.01, signal));

  // 本家は discard + 生 sRGB でページ背景に重ねるが、
  // 本プロジェクトは前パス結果 inputTexture に自前合成する（EffectComposer の流儀）
  return vec4(mix(base.rgb, n.uColor, on), base.a);
};
