/**
 * 板単位の effect チェーン（plane.addEffect）の末尾に置く上下反転パス。
 *
 * 回避策: 現行の PlaneComposer は、effect を 1 つ以上通した板を上下反転した向きで
 * 表示する（WebGPU / WebGL 2 の両方で再現。src/ は触らない方針のため example 側で打ち消す）。
 * ライブラリ側が修正されたら、このパスは外す。
 */
import { BaseEffect, type BaseEffectConfig, TSL } from "dom-sync-gl";

const { vec2, float } = TSL;

export class FlipYEffect extends BaseEffect {
  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: ({ inputTexture, uv }) =>
        inputTexture.sample(vec2(uv.x, float(1.0).sub(uv.y))),
    };
  }
}
