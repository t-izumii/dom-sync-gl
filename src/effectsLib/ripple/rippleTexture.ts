import {
  clamp,
  dot,
  exp,
  float,
  max,
  mix,
  smoothstep,
  step,
  uniform,
  vec2,
  vec4,
} from 'three/tsl';
import type { Node, UniformNode } from 'three/webgpu';
import type { AddFeedbackOptions, FeedbackContext } from '../../index';
import { packState, unpackH, unpackHPrev } from './packing';

export function rippleTexture(options: {
  uSpeed?: UniformNode<number>;
  uDamping?: UniformNode<number>;
  uSplatRadius?: UniformNode<number>;
  uSplatStrength?: UniformNode<number>;
  drawUniforms?: Record<string, UniformNode<number>>;
  guiLabel?: string;
} = {}): AddFeedbackOptions {
  const guiLabel = options.guiLabel ?? '波紋 (Ripple / feedback)';
  const uSpeed = options.uSpeed ?? uniform(0.45);
  const uDamping = options.uDamping ?? uniform(0.996);
  const uSplatRadius = options.uSplatRadius ?? uniform(0.01);
  const uSplatStrength = options.uSplatStrength ?? uniform(0.6);

  return {
    size: 256,
    outputUniform: 'uRippleTex',
    uniforms: { uSpeed, uDamping, uSplatRadius, uSplatStrength },
    outputNode: (ctx: FeedbackContext) => {
      const { uPrev, uMouse, uHover, uAspect, uResolution, uMove, uv: uvN } = ctx;
      const texel = vec2(1.0, 1.0).div(uResolution);

      const readH = (sampleUv: Node): Node => {
        const s = uPrev.sample(sampleUv);
        return unpackH(s.rg).mul(step(0.5, s.a));
      };

      const prev = uPrev.sample(uvN);
      const init = step(0.5, prev.a);
      const h = unpackH(prev.rg).mul(init);
      const hPrev = unpackHPrev(prev.bg).mul(init);

      const lap = readH(uvN.sub(vec2(texel.x, 0.0)))
        .add(readH(uvN.add(vec2(texel.x, 0.0))))
        .add(readH(uvN.sub(vec2(0.0, texel.y))))
        .add(readH(uvN.add(vec2(0.0, texel.y))))
        .sub(h.mul(4.0));

      let hNext: Node = h.mul(2.0).sub(hPrev).add(uSpeed.mul(lap)).mul(uDamping);

      hNext = mix(hNext, h.add(lap.mul(0.25)), 0.08);

      const d = uvN.sub(uMouse).mul(vec2(uAspect, 1.0));
      const r2 = max(uSplatRadius.mul(uSplatRadius), 1e-4);
      hNext = hNext.add(
        uSplatStrength
          .mul(exp(dot(d, d).div(r2).mul(-1.0)))
          .mul(uHover)
          .mul(uMove),
      );

      const m = 0.04;
      const edge = smoothstep(0.0, m, uvN.x)
        .mul(smoothstep(0.0, m, float(1.0).sub(uvN.x)))
        .mul(smoothstep(0.0, m, uvN.y))
        .mul(smoothstep(0.0, m, float(1.0).sub(uvN.y)));
      hNext = hNext.mul(mix(0.9, 1.0, edge));

      hNext = clamp(hNext, -1.0, 1.0);

      return vec4(packState(hNext, h), 1.0);
    },
    setupGUI: (gui, buffer) => {
      const ru = buffer.uniforms;
      const folder = gui.addFolder(guiLabel);

      const sim = folder.addFolder('シミュレーション');
      sim.add(ru.uSpeed, 'value', 0.05, 0.5, 0.005).name('波速');
      sim.add(ru.uDamping, 'value', 0.9, 1.0, 0.0005).name('減衰（消える速さ）');
      sim.add(ru.uSplatStrength, 'value', 0.0, 3.0, 0.01).name('波源の強さ');
      sim.add(ru.uSplatRadius, 'value', 0.002, 0.06, 0.001).name('波源の半径');
    },
  };
}
