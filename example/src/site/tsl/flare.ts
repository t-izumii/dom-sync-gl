/**
 * マニフェストの GL アクセント。本文の背後で「読み進めた位置」に横一文字の
 * アナモルフィックフレアを灯す。uProgress（0..1）は manifesto.ts がスクロールから計算する。
 * 加算合成で使うので、alpha は光量として扱う。
 */
import { TSL } from "dom-sync-gl";
import type { PlaneNodeContext } from "dom-sync-gl";
import type { Node, UniformNode } from "three/webgpu";
import { shared } from "../uniforms";

const { float, vec3, vec4, exp, abs, mix, smoothstep, sin, max } = TSL;

export const flareColorNode = (ctx: PlaneNodeContext): Node => {
  const { uv, uResolution } = ctx;
  const { uProgress } = ctx.uniforms as unknown as { uProgress: UniformNode<number> };

  // 上から下へ読み進める位置（左下原点なので反転）
  const y = float(1.0).sub(uProgress);
  const dy = abs(uv.y.sub(y)).mul(uResolution.y);
  const dx = abs(uv.x.sub(0.5)).mul(2.0);

  // 芯（2px 程度）+ にじみ + 横方向の減衰。端にいくほど寒色へ
  const core = exp(dy.mul(-0.9));
  const soft = exp(dy.mul(-0.06));
  const along = exp(dx.mul(dx).mul(-2.4));
  const shimmer = sin(uv.x.mul(40.0).add(shared.uClock.mul(1.3))).mul(0.08).add(0.92);
  const tint = mix(mix(shared.uKeyB, vec3(1.0), 0.3), shared.uCounter, smoothstep(0.2, 1.0, dx));

  // 読み始め・読み終わりでは消す
  const life = smoothstep(0.0, 0.06, uProgress).mul(smoothstep(1.0, 0.94, uProgress));
  const intensity = core.mul(0.9).add(soft.mul(0.22)).mul(along).mul(shimmer).mul(life);
  return vec4(tint.mul(intensity), max(intensity, 0.0));
};
