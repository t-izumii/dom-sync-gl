/**
 * 00 Prologue の GL パーツ。
 * - 全画面の背景「光の場」: createPlane(null, …)。viewport に固定され、ページ全体の地になる
 * - 見出し HALATION: createTextPlane で DOM の文字を焼き、屈折・RGB 分離・ハレーションを掛ける
 */
import { TSL, type DomSyncGL } from "dom-sync-gl";
import { createBackgroundNode } from "../tsl/background";
import { createHalationTextNode } from "../tsl/type";
import { COARSE } from "../env";
import { LAYER, Smoothed, layer, type Part } from "./common";

const { uniform } = TSL;

export function createBackground(app: DomSyncGL, octaves: number): Part {
  const plane = app.createPlane(null, { colorNode: createBackgroundNode(octaves) });
  layer(plane, LAYER.background);
  return { update: () => {} };
}

export interface HeroTitle extends Part {
  /** イントロの途中で呼ばれ、文字のせり上がりを始める */
  reveal(): void;
}

export function createHeroTitle(app: DomSyncGL, el: HTMLElement, reduced: () => boolean): HeroTitle {
  const uReveal = uniform(0);
  const uHover = uniform(0);
  const plane = app.createTextPlane(el, {
    // タッチ端末では滲みのサンプルを省く（巨大な板で 1 画素 8 回の読み出しになるため）
    colorNode: createHalationTextNode({ glowRadius: 0.06, glow: COARSE ? 0 : 0.6, refraction: 0.08 }),
    uniforms: { uReveal, uHover },
    // clamp() の fluid な font-size をリサイズに追従させる
    refreshStyleOnResize: true,
  });
  layer(plane, LAYER.text);

  // リビールは 2 秒弱で収まる程度の速さ。ホバーは少し速く
  const reveal = new Smoothed(1.6);
  const hover = new Smoothed(5);

  return {
    reveal() {
      reveal.target = 1;
      if (reduced()) reveal.value = 1;
    },
    update(dt) {
      uReveal.value = reveal.step(dt);
      hover.target = plane.isHovered() && !reduced() ? 1 : 0;
      uHover.value = hover.step(dt);
    },
  };
}
