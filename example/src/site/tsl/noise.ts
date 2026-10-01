/**
 * TSL の共通ノイズ。value noise と、オクターブ数を固定した fbm を作る。
 * ノイズは Fn でシェーダー関数化して共有し、呼び出しのたびにノードグラフが
 * 膨らまないようにしている。ループは JS 側で展開する（オクターブ数は定数）。
 */
import { TSL } from "dom-sync-gl";
import type { Node } from "three/webgpu";

const { Fn, float, vec2, fract, floor, dot, mix, sin, cos } = TSL;

/** 2D → 1D のハッシュ（sin を使わない版。WebGL / WebGPU で精度差が出にくい） */
export const hash21 = Fn(([p]: [Node]) => {
  const q = fract(p.mul(vec2(123.34, 456.21)));
  const r = q.add(dot(q, q.add(45.32)));
  return fract(r.x.mul(r.y));
});

/** 2D → 2D のハッシュ。ボロノイのセル中心に使う */
export const hash22 = Fn(([p]: [Node]) => {
  const a = hash21(p);
  const b = hash21(p.add(vec2(17.13, 3.71)));
  return vec2(a, b);
});

export const vnoise = Fn(([p]: [Node]) => {
  const i = floor(p);
  const f = fract(p);
  const a = hash21(i);
  const b = hash21(i.add(vec2(1.0, 0.0)));
  const c = hash21(i.add(vec2(0.0, 1.0)));
  const d = hash21(i.add(vec2(1.0, 1.0)));
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

// オクターブごとに座標を回転させ、格子の方向性（縦横の筋）を目立たなくする。
const ROT_C = Math.cos(0.5);
const ROT_S = Math.sin(0.5);

const fbmCache = new Map<number, (p: Node) => Node>();

/**
 * オクターブ数を固定した fbm を返す。同じオクターブ数は同じ Fn を共有する。
 * フラグメントの負荷はオクターブ数に比例するので、呼び出し側は env.OCTAVES を渡す。
 */
export function makeFbm(octaves: number): (p: Node) => Node {
  const cached = fbmCache.get(octaves);
  if (cached) return cached;
  const fn = Fn(([p]: [Node]) => {
    let v: Node = float(0.0);
    let q: Node = p;
    let amp = 0.5;
    for (let i = 0; i < octaves; i++) {
      v = v.add(vnoise(q).mul(amp));
      q = vec2(
        q.x.mul(ROT_C).sub(q.y.mul(ROT_S)),
        q.x.mul(ROT_S).add(q.y.mul(ROT_C)),
      )
        .mul(2.03)
        .add(vec2(1.7, 9.2));
      amp *= 0.5;
    }
    return v;
  }) as unknown as (p: Node) => Node;
  fbmCache.set(octaves, fn);
  return fn;
}

/** 0..1 の値を、暖色〜寒色を回るスペクトルへ（プリズムの分光に使う） */
export const spectrum = Fn(([h]: [Node]) => {
  const t = h.mul(6.28318);
  return TSL.vec3(
    cos(t).mul(0.5).add(0.5),
    cos(t.sub(2.094)).mul(0.5).add(0.5),
    cos(t.sub(4.188)).mul(0.5).add(0.5),
  );
});

/** フィルムグレイン用の高周波ハッシュ（フレームごとに変えるため t を足す） */
export const grain = (p: Node, t: Node): Node =>
  fract(sin(dot(p.add(fract(t.mul(7.13)).mul(100.0)), vec2(12.9898, 78.233))).mul(43758.5453));
