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

export interface SmoothCursorNodeUniforms {
  uPoints: Node;
  uCount: Node;
  uColor: Node;
  uGlow: Node;
  uAspect: Node;
  uBlendMode: Node;
}

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

    const p = vec2(ctx.uv.x.mul(u.uAspect), ctx.uv.y);

    const brightness = float(0.0).toVar();

    Loop(u.uCount.sub(1), ({ i }) => {
      const pa = u.uPoints.element(i);
      const pb = u.uPoints.element(i.add(1));
      const a = vec2(pa.x.mul(u.uAspect), pa.y);
      const b = vec2(pb.x.mul(u.uAspect), pb.y);

      const dh = segDist(p, a, b);
      const d = dh.x;
      const h = dh.y;
      const hw = mix(pa.z, pb.z, h);
      const w = mix(pa.w, pb.w, h);

      const aa = fwidth(d).add(1e-5);
      const core = float(1.0).sub(smoothstep(hw.sub(aa), hw.add(aa), d));

      const halo = exp(
        max(d.sub(hw), 0.0).div(max(hw.mul(u.uGlow), 1e-5)).negate(),
      ).mul(0.6);

      brightness.assign(max(brightness, max(core, halo).mul(w)));
    });

    const trail = u.uColor.mul(clamp(brightness, 0.0, 1.0));
    const screen = float(1.0).sub(
      float(1.0).sub(base.rgb).mul(float(1.0).sub(trail)),
    );
    const col = select(u.uBlendMode.equal(1), base.rgb.add(trail), screen);

    return vec4(col, base.a);
  })();
