/**
 * 02 Exhibits の GL パーツ。各 .js-exhibit-art に DOM ロックした板を貼り、
 * data-art で選んだ作品シェーダーを額装（createFrameNode）して描く。
 *
 * - 位置: ギャラリーの track は transform で横に送られるので updateRectEveryFrame
 * - 出現: onInView（rootMargin 0 = 実際に画面へ入った時）で斜めのワイプ
 * - ホバー: plane.isHovered()（raycast）を平滑化してレンズの強さに
 * - しなり: bendPositionNode が共有の uVelocity を読む（segments で頂点を用意）
 *
 * 画面外の板はライブラリが IntersectionObserver で mesh ごと非表示にするので、
 * フラグメントの負荷は見えている作品の分だけになる。
 */
import { TSL, type DomSyncGL } from "dom-sync-gl";
import { ARTS, bendPositionNode, createFrameNode } from "../tsl/exhibits";
import { LAYER, Smoothed, layer, type Part } from "./common";

const { uniform } = TSL;

export function createExhibits(
  app: DomSyncGL,
  els: HTMLElement[],
  opts: { octaves: number; reduced: () => boolean; hoverable: boolean; segments: number },
): Part {
  const items = els.map((el, i) => {
    const art = ARTS[el.dataset.art ?? ""] ?? ARTS.caustic;
    const uReveal = uniform(0);
    const uHover = uniform(0);
    const reveal = new Smoothed(1.3);
    const hover = new Smoothed(4.5);
    const plane = app.createPlane(el, {
      colorNode: createFrameNode(art, opts.octaves),
      positionNode: bendPositionNode,
      segments: opts.segments,
      updateRectEveryFrame: true,
      uniforms: { uReveal, uHover, uSeed: uniform(i * 0.37 + 0.11) },
      inViewRootMargin: "0px",
      onInView: () => {
        reveal.target = 1;
        if (opts.reduced()) reveal.value = 1;
      },
    });
    layer(plane, LAYER.art + i * 0.01);
    return { plane, uReveal, uHover, reveal, hover };
  });

  return {
    update(dt) {
      for (const it of items) {
        it.uReveal.value = it.reveal.step(dt);
        it.hover.target = opts.hoverable && it.plane.isHovered() ? 1 : 0;
        it.uHover.value = it.hover.step(dt);
      }
    },
  };
}
