/**
 * 波紋エフェクトの feedback 版（TSL）。波動方程式（leapfrog）を FeedbackBuffer の
 * ping-pong で解き、高さ場テクスチャを plane uniform（既定 `uRippleTex`）へ供給する。
 * h^n / h^{n-1} の 2 世代は packing.ts の 12bit パッキングで 1 テクスチャに同居させる
 * ため、前フレーム 1 枚（uPrev）だけで完結する。
 */
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

/**
 * 波紋エフェクトの feedback 版。波動方程式を FeedbackBuffer の ping-pong で解き、高さ場
 * テクスチャを plane uniform（既定 `uRippleTex`）へ供給する source。GUI（setupGUI）を所有する。
 * post 版はクラス {@link RipplePostEffect}。
 *
 * v0.4 の addFeedback 契約により、consume 側 plane は `uRippleTex` と同名の texture()
 * ノードを createPlane の options.uniforms に事前宣言しておく。
 *
 * @example
 * ```ts
 * import { TSL } from 'dom-sync-gl';
 * const uRippleTex = TSL.texture();
 * const plane = app.createPlane('.card', {
 *   uniforms: { uRippleTex },
 *   colorNode: (ctx) =>
 *     rippleApplyNode({ rippleTex: uRippleTex, tex: ctx.uTexture, uv: ctx.uv }),
 * });
 * plane.addFeedback(rippleTexture());
 * ```
 */
export function rippleTexture(options: {
  /** 波速²（leapfrog の安定条件より 0〜0.5）。TSL の uniform() で生成したノード。 */
  uSpeed?: UniformNode<number>;
  /** 毎ステップの減衰（1 に近いほど長く残る）。 */
  uDamping?: UniformNode<number>;
  /** 波源の半径（UV）。 */
  uSplatRadius?: UniformNode<number>;
  /** 波源の強さ。 */
  uSplatStrength?: UniformNode<number>;
  /** consume 側 plane の描画 uniform。 */
  drawUniforms?: Record<string, UniformNode<number>>;
  /** GUI フォルダのラベル。 */
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

      // 未初期化(A=0)は 0 扱い（生デコードの h=-1 による四角い縁波を防ぐ）
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

      // Nyquist（市松）モードを抑える拡散
      hNext = mix(hNext, h.add(lap.mul(0.25)), 0.08);

      // 動いた時だけ単発インパルス（uMove ゲート）
      const d = uvN.sub(uMouse).mul(vec2(uAspect, 1.0));
      const r2 = max(uSplatRadius.mul(uSplatRadius), 1e-4);
      hNext = hNext.add(
        uSplatStrength
          .mul(exp(dot(d, d).div(r2).mul(-1.0)))
          .mul(uHover)
          .mul(uMove),
      );

      // 端を吸収して反射を抑える境界
      const m = 0.04;
      const edge = smoothstep(0.0, m, uvN.x)
        .mul(smoothstep(0.0, m, float(1.0).sub(uvN.x)))
        .mul(smoothstep(0.0, m, uvN.y))
        .mul(smoothstep(0.0, m, float(1.0).sub(uvN.y)));
      hNext = hNext.mul(mix(0.9, 1.0, edge));

      hNext = clamp(hNext, -1.0, 1.0);

      // A=1.0 は「初期化済み」フラグを兼ねる（clear 直後の A=0 と区別する）
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
