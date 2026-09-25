import { BaseEffect, type BaseEffectConfig, THREE, TSL } from "dom-sync-gl";
import { filmNode, textHoverNode } from "./shaders";

const { uniform } = TSL;

// 色収差 + グレイン + ビネットをまとめた仕上げ用フルスクリーンエフェクト。
// app.addEffect(new FilmEffect()) で内部 EffectComposer のチェーンに繋がる。
// uniform ノードはフィールドとして生成時に作り、getConfig() の outputNode と
// uniforms（setUniform の参照先）の両方から同じノードを共有する。
export class FilmEffect extends BaseEffect {
  private readonly uResolution = uniform(new THREE.Vector2(1, 1));
  private readonly uStrength = uniform(0);

  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: (ctx) =>
        filmNode(ctx, {
          uTime: this.uTime,
          uResolution: this.uResolution,
          uStrength: this.uStrength,
        }),
      uniforms: {
        uTime: this.uTime,
        uResolution: this.uResolution,
        uStrength: this.uStrength,
      },
    };
  }

  // 毎フレーム Core から呼ばれる。
  update(time: number): void {
    this.setUniform("uTime", time);
  }

  // main 側から解像度 / スクロール速度を流し込む。
  setResolution(w: number, h: number): void {
    this.setUniform("uResolution", new THREE.Vector2(w, h));
  }

  setStrength(s: number): void {
    this.setUniform("uStrength", s);
  }
}

// DomTextPlane に addEffect() する板単位のエフェクト。
// app.addEffect() のフルスクリーン合成とは別経路で、その板だけに掛かる。
// 前段テクスチャは ctx.inputTexture として自動注入されるので getConfig() では宣言しない。
export class TextHoverEffect extends BaseEffect {
  private readonly uHover = uniform(0);

  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: (ctx) => textHoverNode(ctx, this.uHover),
      uniforms: {
        uHover: this.uHover,
      },
    };
  }

  setHover(v: number): void {
    this.setUniform("uHover", v);
  }
}
