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
  screenSize,
  select,
  smoothstep,
  step,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { EffectContext } from '../../index';

const mod289 = (x: Node): Node => x.sub(floor(x.mul(1 / 289)).mul(289));
const permute = (x: Node): Node => mod289(x.mul(34).add(1).mul(x));

const snoise = Fn(([v]: [Node]) => {
  const Cx = 0.211324865405187;
  const Cy = 0.366025403784439;
  const Cz = -0.577350269189626;
  const Cw = 0.024390243902439;

  const cell = floor(v.add(dot(v, vec2(Cy, Cy))));
  const x0 = v.sub(cell).add(dot(cell, vec2(Cx, Cx)));
  const i1 = select(x0.x.greaterThan(x0.y), vec2(1, 0), vec2(0, 1));
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
  const g = vec3(
    a0.x.mul(x0.x).add(h.x.mul(x0.y)),
    a0.y.mul(x12xy.x).add(h.y.mul(x12xy.y)),
    a0.z.mul(x12zw.x).add(h.z.mul(x12zw.y)),
  );
  return dot(m, g).mul(130);
});

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

export interface DitherSimNodes {
  uPrev: TextureNode;
  uv: Node;
  uTime: UniformNode<number>;
  uMouse: UniformNode<Vector2>;
  uSpeed: UniformNode<number>;
  uRadius: UniformNode<number>;
  uDecay: UniformNode<number>;
  uIntensity: UniformNode<number>;
}

export const ditherSimNode = (n: DitherSimNodes): Node => {
  const vUv = n.uv;
  const texel = vec2(1).div(screenSize);

  const velocity = curlNoise(vUv.mul(0.5).add(n.uTime.mul(0.1)));
  const advectedUv = vUv.sub(velocity.mul(0.001));

  const c = n.uPrev.sample(advectedUv).r;
  const t = n.uPrev.sample(advectedUv.add(vec2(0, texel.y))).r;
  const b = n.uPrev.sample(advectedUv.sub(vec2(0, texel.y))).r;
  const l = n.uPrev.sample(advectedUv.sub(vec2(texel.x, 0))).r;
  const r = n.uPrev.sample(advectedUv.add(vec2(texel.x, 0))).r;
  const diffused = c.add(t).add(b).add(l).add(r).div(5);

  const aspect = screenSize.x.div(screenSize.y);
  const dist = length(vUv.sub(n.uMouse).mul(vec2(aspect, 1)));
  const brush = exp(pow(dist.div(n.uRadius), 2).negate())
    .mul(n.uIntensity)
    .mul(smoothstep(0.0, 0.01, n.uSpeed))
    .mul(0.5);

  const value = min(diffused.add(brush), 0.95).sub(n.uDecay);
  return vec4(vec3(max(value, 0.0)), 1);
};

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

  const on = step(threshold, signal).mul(step(0.01, signal));

  return vec4(mix(base.rgb, n.uColor, on), base.a);
};
