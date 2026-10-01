/**
 * 03 Process の GL パーツ。effectsLib の LiquidSwap で、制作段階の図版を
 * 液体ガラス越しに切り替える。図版は textures.ts が Canvas 2D で描く。
 *
 * - 段階ボタン（aria-pressed）で切り替え。遷移中の連打は最後の 1 回だけ覚えておく
 * - 遷移の中心は、板の上にポインタがあればその位置、なければ中央
 * - 図版が 4 割見えた最初の 1 回だけ、無地 → Sketch のリビールを自動で見せる
 */
import type { DomSyncGL } from "dom-sync-gl";
import { LiquidSwap } from "../../../../src/effectsLib/liquidSwap";
import { drawBlank, drawFinal, drawLightTest, drawSketch } from "../textures";
import { easeInOutCubic } from "../env";
import { LAYER, layer, type Part } from "./common";

export const CAPTIONS = [
  "部屋の寸法と光源の位置を、鉛筆で何度も引き直す。残像の長さはこの段階で決まる。",
  "暗室で実際に灯し、露出を段階的に変えて滲みの出方を測る。芯はまだ荒い。",
  "光を重ね、床の反射と長い残像の尾まで整えた最終形。部屋を出たあとも目に残る。",
];

export function createProcess(
  app: DomSyncGL,
  visual: HTMLElement,
  buttons: HTMLButtonElement[],
  caption: HTMLElement | null,
  opts: { reduced: () => boolean; signal: AbortSignal },
): Part {
  const blank = drawBlank();
  const stages = [drawSketch(), drawLightTest(), drawFinal()];

  let introduced = false;
  let current = 0;
  let animating = false;
  let t = 0;
  let queued: number | null = null;

  // 色収差は線画（Sketch）の細い線で RGB が大きく割れて見えるので控えめにする
  const swap = new LiquidSwap({ refraction: 1.0, aberration: 0.6, edgeGlow: 1.4, flow: 1.0 });
  const plane = app.createPlane(visual, {
    ...swap.planeOptions(),
    updateRectEveryFrame: false,
    inViewRootMargin: "0px",
  });

  // 最初のリビールは図版が 4 割見えてから始める（板の表示判定の rootMargin 0 だと
  // 1px 入った時点で始まり、遷移の大半が画面外で終わってしまう）
  const introIO = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      introIO.disconnect();
      if (!introduced) {
        introduced = true;
        start(0, true);
      }
    },
    { threshold: 0.4 },
  );
  introIO.observe(visual);
  layer(plane, LAYER.art);
  swap.setTextures(blank, stages[0]);
  swap.progress = 0;

  const setPressed = (i: number) => {
    buttons.forEach((b, k) => b.setAttribute("aria-pressed", String(k === i)));
    if (caption) caption.textContent = CAPTIONS[i];
  };

  function start(i: number, fromBlank = false) {
    if (animating) {
      queued = i;
      return;
    }
    if (i === current && !fromBlank) return;
    current = i;
    setPressed(i);
    swap.setNextTexture(stages[i]);
    if (plane.isHovered()) {
      const uv = plane.getMouseUV();
      swap.setCenter(uv.x, uv.y);
    } else {
      swap.setCenter(0.5, 0.5);
    }
    animating = true;
    t = 0;
  }

  buttons.forEach((b) => {
    b.addEventListener(
      "click",
      () => {
        // 自動リビール前に押された場合は、無地からその段階へ遷移させる
        const first = !introduced;
        introduced = true;
        introIO.disconnect();
        start(Number(b.dataset.stage ?? 0), first);
      },
      { signal: opts.signal },
    );
  });

  return {
    update(dt) {
      if (!animating) return;
      const duration = opts.reduced() ? 0.35 : 1.6;
      t = Math.min(1, t + dt / duration);
      swap.progress = easeInOutCubic(t);
      if (t >= 1) {
        // 遷移後の図版を prev に移し、次の遷移の起点にする
        swap.commit();
        animating = false;
        if (queued !== null) {
          const next = queued;
          queued = null;
          start(next);
        }
      }
    },
    destroy() {
      introIO.disconnect();
      // LiquidSwap はテクスチャを所有しないので、描いた側が解放する
      blank.dispose();
      for (const tex of stages) tex.dispose();
    },
  };
}
