/**
 * スムーズカーソルの描画パス（TSL ノード版）。CPU 側のばね連鎖が書き込んだ uPoints
 * （xy = 位置 UV / z = 半幅 UV / w = 強度）を隣接ペアの線分 SDF として評価し、
 * テーパー付きのポリライン帯 + 指数減衰グローを前段パス出力（ctx.inputTexture）に
 * 合成する。本家（React Bits Pro "Smooth Cursor"）は Canvas 2D の可変 lineWidth
 * stroke + CSS blur だが、本移植はソリッドコア + exp グローで等価な見た目を作る。
 */
import type { Node } from 'three/webgpu';
import {
  Fn,
  Loop,
  clamp,
  dot,
  exp,
  float,
  fwidth,
  length,
  max,
  mix,
  select,
  smoothstep,
  vec2,
  vec4,
} from 'three/tsl';
import type { EffectContext } from '../../index';

/** smoothCursorNode が参照する uniform ノード一式（生成は effect 側）。 */
export interface SmoothCursorNodeUniforms {
  /** vec4 配列（xy = 位置 UV / z = 半幅 UV / w = 強度）。uniformArray ノード。 */
  uPoints: Node;
  /** 有効な点数（int）。ループ回数は uCount - 1。 */
  uCount: Node;
  /** トレイルの色。 */
  uColor: Node;
  /** 発光の広がり（ストローク半幅に対する倍率）。 */
  uGlow: Node;
  /** 画面アスペクト比（width / height）。 */
  uAspect: Node;
  /** 0 = screen 合成、1 = 加算合成（int）。 */
  uBlendMode: Node;
}

/*
 * 線分 a-b までの距離。GLSL 版は out float h で射影パラメータを返して
 * いたが、TSL に out 引数はないため vec2(距離, h) で返す。h（0..1）は
 * 呼び出し側が半幅・強度の線形補間に使う。
 */
const segDist = Fn(([p, a, b]: [Node, Node, Node]) => {
  const pa = p.sub(a);
  const ba = b.sub(a);
  const h = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-8)), 0.0, 1.0);
  return vec2(length(pa.sub(ba.mul(h))), h);
});

export const smoothCursorNode = (
  ctx: EffectContext,
  u: SmoothCursorNodeUniforms,
): Node =>
  Fn(() => {
    const base = ctx.inputTexture;

    // アスペクト補正した座標系（y 基準）。半幅も y（画面高さ）基準の UV。
    const p = vec2(ctx.uv.x.mul(u.uAspect), ctx.uv.y);

    const brightness = float(0.0).toVar();

    // GLSL 版の「MAX_POINTS-1 回ループ + i >= uCount-1 で break」は、
    // uCount が CPU 側で 2..MAX_POINTS にクランプ済みのため
    // uCount-1 回の動的ループと等価。
    Loop(u.uCount.sub(1), ({ i }) => {
      const pa = u.uPoints.element(i);
      const pb = u.uPoints.element(i.add(1));
      const a = vec2(pa.x.mul(u.uAspect), pa.y);
      const b = vec2(pb.x.mul(u.uAspect), pb.y);

      const dh = segDist(p, a, b);
      const d = dh.x;
      const h = dh.y;
      const hw = mix(pa.z, pb.z, h); // 半幅（先頭太 → 尾細のテーパー）
      const w = mix(pa.w, pb.w, h); // 強度（presence * 不透明度）

      // ソリッドコア（AA 付きストローク。本家の stroke に相当）
      const aa = fwidth(d).add(1e-5);
      const core = float(1.0).sub(smoothstep(hw.sub(aa), hw.add(aa), d));

      // ストローク外縁からの指数減衰グロー（本家の CSS blur に相当）
      const halo = exp(
        max(d.sub(hw), 0.0).div(max(hw.mul(u.uGlow), 1e-5)).negate(),
      ).mul(0.6);

      // セグメント継ぎ目で二重に明るくならないよう max 合成
      brightness.assign(max(brightness, max(core, halo).mul(w)));
    });

    const trail = u.uColor.mul(clamp(brightness, 0.0, 1.0));
    const screen = float(1.0).sub(
      float(1.0).sub(base.rgb).mul(float(1.0).sub(trail)),
    );
    const col = select(u.uBlendMode.equal(1), base.rgb.add(trail), screen);

    return vec4(col, base.a);
  })();
