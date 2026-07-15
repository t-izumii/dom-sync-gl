import { BaseEffect, type BaseEffectConfig, THREE } from "dom-sync-gl";
import { filmFragment, textHoverFragment } from "./shaders";

// 色収差 + グレイン + ビネット + 走査線をまとめた仕上げ用フルスクリーンエフェクト。
// app.addEffect(new FilmEffect()) で内部 EffectComposer のチェーンに繋がる。
export class FilmEffect extends BaseEffect {
  protected getConfig(): BaseEffectConfig {
    return {
      fragmentShader: filmFragment,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uStrength: { value: 0 },
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
// tDiffuse は EffectPass が自動注入するので getConfig() では宣言しない。
export class TextHoverEffect extends BaseEffect {
  protected getConfig(): BaseEffectConfig {
    return {
      fragmentShader: textHoverFragment,
      uniforms: {
        uHover: { value: 0 },
      },
    };
  }

  setHover(v: number): void {
    this.setUniform("uHover", v);
  }
}
