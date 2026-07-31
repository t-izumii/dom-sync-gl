/**
 * src/effectsLib/ の 9 エフェクトを 1 つずつ動作テストするページ。
 *
 * `?effect=<name>` クエリで対象を切り替える（既定: pixelTrail）。
 * 画像アセットに依存せずオフラインで動くよう、plane / カーソル用のテクスチャは
 * すべて Canvas 2D で描いたグラデーションから生成する。
 *
 * - post 系（pixelTrail / smoothCursor / mouseFlow / ditherCursor / splashCursor /
 *   ripple）: 全画面グラデーション plane を敷き、app.addEffect() のみで駆動
 * - plane 系（rippleFeedback / liquidSwap / stickerPeel）: `.demo-image` に
 *   同期した plane を作り、colorNode / positionNode を配線
 */
import { DomSyncGL, THREE, TSL } from "dom-sync-gl";
import GUI from "lil-gui";
import { PixelTrailEffect } from "../../src/effectsLib/pixelTrail";
import { SmoothCursorEffect } from "../../src/effectsLib/smoothCursor";
import { MouseFlowEffect } from "../../src/effectsLib/mouseFlow";
import { MouseEffect } from "../../src/effectsLib/mouse";
import { DitherCursorEffect } from "../../src/effectsLib/ditherCursor";
import { SplashCursorEffect } from "../../src/effectsLib/splashCursor";
import {
  RippleEffect,
  rippleApplyNode,
  rippleTexture,
} from "../../src/effectsLib/ripple";
import { LiquidSwap } from "../../src/effectsLib/liquidSwap";
import { StickerPeel } from "../../src/effectsLib/stickerPeel";

/* ==----------------------------------------------------
 * Canvas 2D テクスチャ生成（外部画像なしでオフライン動作を保つ）
 * ---------------------------------------------------- */

/**
 * 斜めグラデーション + 判別用の円とラベルを描いた CanvasTexture を返す。
 * dispose は呼び出し側（plane に渡す場合は takeOwnership で plane 側）の責務。
 */
function makeGradientTexture(
  colorA: string,
  colorB: string,
  label: string,
): THREE.CanvasTexture {
  const w = 1024;
  const h = 768;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d")!;

  const grad = c.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, colorA);
  grad.addColorStop(1, colorB);
  c.fillStyle = grad;
  c.fillRect(0, 0, w, h);

  // 歪み・遷移の見え方が分かるよう、格子と円を重ねておく
  c.strokeStyle = "rgba(255, 255, 255, 0.18)";
  c.lineWidth = 2;
  for (let x = 0; x <= w; x += 128) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, h);
    c.stroke();
  }
  for (let y = 0; y <= h; y += 128) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(w, y);
    c.stroke();
  }
  c.strokeStyle = "rgba(255, 255, 255, 0.5)";
  c.lineWidth = 6;
  c.beginPath();
  c.arc(w / 2, h / 2, 220, 0, Math.PI * 2);
  c.stroke();

  c.fillStyle = "rgba(255, 255, 255, 0.9)";
  c.font = "600 96px system-ui, sans-serif";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(label, w / 2, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ==----------------------------------------------------
 * エフェクト定義（?effect=<name> の name → 配線）
 * ---------------------------------------------------- */

interface EffectDef {
  /** パネルに出す操作ヒント */
  hint: string;
  /** plane 系: `.demo-image` を表示して同期先にする */
  needsDemoImage?: boolean;
  /** 淡い発光を扱うエフェクト用: グラデ地の代わりにほぼ黒の無地を敷く */
  darkGround?: boolean;
  setup: (app: DomSyncGL) => void;
}

/** 0 ↔ 1 をサイン波で往復する progress（speed は rad/秒）。 */
const pingPong = (speed: number): number =>
  0.5 - 0.5 * Math.cos((performance.now() / 1000) * speed);

const EFFECTS: Record<string, EffectDef> = {
  pixelTrail: {
    hint: "マウスを動かすと軌跡のセルが点灯する",
    setup: (app) => {
      app.addEffect(new PixelTrailEffect());
    },
  },
  smoothCursor: {
    hint: "マウスを動かすとばね連鎖のトレイルが追従する",
    setup: (app) => {
      app.addEffect(new SmoothCursorEffect());
    },
  },
  mouseFlow: {
    hint: "マウスの軌跡に沿って画面が流体的に歪む",
    setup: (app) => {
      app.addEffect(new MouseFlowEffect());
    },
  },
    mouse: {
    hint: "マウスの軌跡に沿って画面が流体的に歪む",
    setup: (app) => {
      app.addEffect(new MouseEffect());
    },
  },
  ditherCursor: {
    hint: "マウスを動かすとディザドットのインクが広がる",
    setup: (app) => {
      app.addEffect(new DitherCursorEffect());
    },
  },
  splashCursor: {
    hint: "マウス移動で色付きインクが渦を巻く。クリックでバースト",
    // 本家(reactbits サイトデモ)はほぼ黒背景のオーバーレイ。インク雲の外縁は
    // 輝度数%しかなく明るい地では埋もれるため、このデモだけ暗い無地を敷く。
    darkGround: true,
    setup: (app) => {
      // reactbits サイトデモの既定に合わせる(Rainbow OFF・紫)。GUI で変更可
      app.addEffect(
        new SplashCursorEffect({ rainbowMode: false, color: "#a855f7" }),
      );
    },
  },
  ripple: {
    hint: "マウスを動かすと画面全体に波紋が走る（post 版）",
    setup: (app) => {
      app.addEffect(new RippleEffect({ resolution: 320 }));
    },
  },
  rippleFeedback: {
    hint: "中央の画像の上でマウスを動かすと波紋が走る（feedback 版）",
    needsDemoImage: true,
    setup: (app) => {
      const uRippleTex = TSL.texture();
      const plane = app.createPlane(".js-demo-image", {
        uniforms: { uRippleTex },
        colorNode: (ctx) =>
          rippleApplyNode({ rippleTex: uRippleTex, tex: ctx.uTexture, uv: ctx.uv }),
      });
      plane.setTexture(
        makeGradientTexture("#1c4d8f", "#7fd4c1", "RIPPLE"),
        true,
      );
      plane.addFeedback(rippleTexture());
    },
  },
  liquidSwap: {
    hint: "PREV ↔ NEXT が液体ガラス風の円形リビールで往復する",
    needsDemoImage: true,
    setup: (app) => {
      const swap = new LiquidSwap();
      app.createPlane(".js-demo-image", { colorNode: swap.colorNode });
      // loadLiquidSwapTexture は URL 前提のため、オフラインで完結する
      // CanvasTexture を直接 setTextures に渡す（所有権はこのページ側）。
      swap.setTextures(
        makeGradientTexture("#5a2a6e", "#e08a4a", "PREV"),
        makeGradientTexture("#1c4d8f", "#7fd4c1", "NEXT"),
      );
      app.addUpdateCallback(() => {
        swap.progress = pingPong(0.6);
      });
    },
  },
  stickerPeel: {
    hint: "ステッカーの剥がし（curl）が自動で往復する",
    needsDemoImage: true,
    setup: (app) => {
      const peel = new StickerPeel();
      const plane = app.createPlane(".js-demo-image", peel.planeOptions());
      // 裏面（frontFacing = false）を描くため DoubleSide 設定が必須
      peel.applyTo(plane);
      peel.setTexture(makeGradientTexture("#b8452f", "#e8c95a", "PEEL"));
      app.addUpdateCallback(() => {
        peel.progress = pingPong(0.5);
      });
    },
  },
};

const DEFAULT_EFFECT = "pixelTrail";

/* ==----------------------------------------------------
 * ページ初期化
 * ---------------------------------------------------- */

const requested = new URLSearchParams(location.search).get("effect");
const effectName = requested && requested in EFFECTS ? requested : DEFAULT_EFFECT;
const def = EFFECTS[effectName];
if (requested && !(requested in EFFECTS)) {
  console.warn(
    `[effects-lib] 不明なエフェクト名 "${requested}" のため ${DEFAULT_EFFECT} を表示します。`,
  );
}

// パネル表示: 現在のエフェクト名・ヒント・ナビの active 状態
document.querySelector(".js-current-effect")!.textContent = effectName;
document.querySelector(".js-effect-hint")!.textContent = def.hint;
document
  .querySelectorAll<HTMLAnchorElement>(".js-effect-nav a")
  .forEach((a) => {
    const target = new URL(a.href).searchParams.get("effect");
    if (target === effectName) a.classList.add("is-active");
  });

const demoImage = document.querySelector<HTMLElement>(".js-demo-image")!;
if (def.needsDemoImage) demoImage.hidden = false;

// dom-test.html と同じ attach:'dom' 構成（#gl は CSS で fixed 全画面）。
// autoRaf は既定の true に任せ、毎フレーム処理は addUpdateCallback で行う。
const gui = new GUI({ title: `Effects: ${effectName}` });
const app = new DomSyncGL("#gl", {
  scrollSync: { attach: "dom" },
  maxPixelRatio: 2,
  gui,
  // ?backend=webgl で WebGL 2 フォールバックを強制(バックエンド差の検証用)
  forceWebGL: new URLSearchParams(location.search).get("backend") === "webgl",
});

// WebGPU の device 取得は非同期。待ってから配線すると初回フレームから確実に描画される。
await app.ready;

// post 系の inputTexture が空（透明）だと歪み系エフェクトの効果が見えないため、
// plane 系以外では全画面グラデーション plane を地として敷く。
if (!def.needsDemoImage) {
  const bg = app.createPlane(null, {});
  const ground = def.darkGround
    ? makeGradientTexture("#050508", "#0a0a10", "")
    : makeGradientTexture("#141b2e", "#233a52", effectName);
  bg.setTexture(ground, true);
}

def.setup(app);

if (import.meta.env?.DEV) {
  (window as unknown as { app: DomSyncGL }).app = app;
}
