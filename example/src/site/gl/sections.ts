/**
 * 01 Manifesto / 04 Figures / 05 Visit の GL パーツ。
 * どれも小さいので 1 ファイルにまとめている（Process は liquidSwap を使うので別ファイル）。
 */
import { THREE, TSL, type DomSyncGL } from "dom-sync-gl";
import { MouseFlowEffect } from "../../../../src/effectsLib/mouseFlow";
import { FlipYEffect } from "../FlipYEffect";
import { flareColorNode } from "../tsl/flare";
import { createHalationTextNode, createSweepTextNode } from "../tsl/type";
import { LAYER, Smoothed, layer, type Part } from "./common";

const { uniform } = TSL;

/**
 * マニフェスト本文の背後に灯る横一文字のフレア。
 * 加算合成にして、背景の光と重なった所だけ明るくする。
 */
export function createManifestoFlare(
  app: DomSyncGL,
  el: HTMLElement,
  progress: () => number,
): Part {
  const uProgress = uniform(0);
  const plane = app.createPlane(el, {
    colorNode: flareColorNode,
    uniforms: { uProgress },
  });
  layer(plane, LAYER.flare);
  plane.material.blending = THREE.AdditiveBlending;
  return {
    update() {
      uProgress.value = progress();
    },
  };
}

/** 04 Figures の数字。DomTextPlane に光の帯を通し、画面に入ったら左から拭き取って出す */
export function createFigures(app: DomSyncGL, els: HTMLElement[], reduced: () => boolean): Part {
  const items = els.map((el, i) => {
    const uReveal = uniform(0);
    const reveal = new Smoothed(1.4);
    // 左の数字から順に出すための待ち時間（秒）。タイマーを持たずループで減らす
    const item = { uReveal, reveal, delay: -1 };
    const plane = app.createTextPlane(el, {
      colorNode: createSweepTextNode(),
      uniforms: { uReveal, uSeed: uniform(i * 0.23) },
      refreshStyleOnResize: true,
      inViewRootMargin: "0px",
      onInView: () => {
        if (reduced()) {
          reveal.target = 1;
          reveal.value = 1;
        } else {
          item.delay = i * 0.14;
        }
      },
    });
    layer(plane, LAYER.text);
    return item;
  });
  return {
    update(dt) {
      for (const it of items) {
        if (it.delay >= 0) {
          it.delay -= dt;
          if (it.delay < 0) it.reveal.target = 1;
        }
        it.uReveal.value = it.reveal.step(dt);
      }
    },
  };
}

/**
 * 05 Visit の巨大な「Linger.」。ハレーションの文字に、板単位の post effect として
 * effectsLib の MouseFlowEffect を重ね、ポインタでかき混ぜられるようにする。
 * （精密ポインタかつ動きの抑制なしの時だけ。全画面ではなくこの板だけに掛ける）
 */
export function createVisitTitle(
  app: DomSyncGL,
  el: HTMLElement,
  opts: { reduced: () => boolean; interactive: boolean },
): Part {
  const uReveal = uniform(0);
  const uHover = uniform(0);
  const reveal = new Smoothed(1.2);
  const hover = new Smoothed(4);
  const plane = app.createTextPlane(el, {
    colorNode: createHalationTextNode({ glowRadius: 0.05, glow: 0.75, refraction: 0.05 }),
    uniforms: { uReveal, uHover },
    refreshStyleOnResize: true,
    inViewRootMargin: "0px",
    onInView: () => {
      reveal.target = 1;
      if (opts.reduced()) reveal.value = 1;
    },
  });
  layer(plane, LAYER.text);

  let flow: MouseFlowEffect | null = null;
  if (opts.interactive) {
    flow = plane.addEffect(new MouseFlowEffect({ strength: 1.6, dissipation: 0.94, falloff: 0.16 }));
    // PlaneComposer の上下反転を打ち消す（FlipYEffect.ts の説明を参照）
    plane.addEffect(new FlipYEffect());
  }

  return {
    update(dt) {
      uReveal.value = reveal.step(dt);
      hover.target = opts.interactive && plane.isHovered() ? 1 : 0;
      uHover.value = hover.step(dt);
      // 動きの抑制に切り替わったら流れを止める
      if (flow) flow.enabled = !opts.reduced();
    },
  };
}
