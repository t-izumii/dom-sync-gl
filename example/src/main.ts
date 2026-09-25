/**
 * HALATION — 光の残響展（dom-sync-gl のメインサンプル）の入口。
 *
 * ここはライブラリの初期化と各モジュールの配線だけを持つ。
 *   - site/ui/*   DOM 側（イントロ・章・マニフェスト・ギャラリー・カーソル）
 *   - site/gl/*   GL 側（章ごとの板と文字）
 *   - site/tsl/*  TSL のノード（背景・作品・文字・フレア・ノイズ）
 *   - site/FinishEffect.ts  全画面の仕上げ post effect（イントロ遷移を含む）
 *
 * rAF はこのファイルの 1 本だけ。毎フレーム
 *   Lenis でスクロールを確定 → DOM の配置（ギャラリーの横送り等）と共有 uniform を更新
 *   → app.tick() で板の位置を読んで描画
 * の順に進むので、DOM と GL が同じフレームの値で揃う。
 */
import { DomSyncGL } from "dom-sync-gl";
import Lenis from "lenis";
import type Stats from "stats.js";
import type GUI from "lil-gui";
import "lenis/dist/lenis.css";
import "./site/style.css";

import {
  COARSE,
  DEBUG,
  FINE_POINTER,
  MAX_DPR,
  OCTAVES,
  damp,
  reducedMotionQuery,
} from "./site/env";
import { shared } from "./site/uniforms";
import { FinishEffect } from "./site/FinishEffect";
import { Intro } from "./site/ui/intro";
import { Chapters } from "./site/ui/chapters";
import { Manifesto } from "./site/ui/manifesto";
import { Gallery } from "./site/ui/gallery";
import { Cursor } from "./site/ui/cursor";
import type { Part } from "./site/gl/common";
import { createBackground, createHeroTitle, type HeroTitle } from "./site/gl/hero";
import { createExhibits } from "./site/gl/exhibits";
import { CAPTIONS, createProcess } from "./site/gl/process";
import { createFigures, createManifestoFlare, createVisitTitle } from "./site/gl/sections";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) =>
  Array.from(document.querySelectorAll<T>(sel));

const reduced = () => reducedMotionQuery.matches;

// ページ全体のリスナーはこの signal にまとめ、破棄時に一括で外す
const lifetime = new AbortController();
const { signal } = lifetime;

// ============================================================================
// 1. スムーズスクロール（Lenis）。autoRaf は使わず、下の 1 本のループが駆動する
// ============================================================================
const lenis = new Lenis({
  autoRaf: false,
  smoothWheel: !reduced(),
  // タッチはネイティブのまま（pull-to-refresh や慣性を殺さない）
  syncTouch: false,
});
// イントロが終わるまでスクロールを止める
lenis.stop();
let scrollLocked = true;

document.addEventListener(
  "visibilitychange",
  () => {
    if (document.hidden) lenis.stop();
    else if (!scrollLocked) lenis.start();
  },
  { signal },
);

// ページ内リンクは Lenis で送り、着地先へフォーカスも移す（スキップリンク・ナビ共通）
document.addEventListener(
  "click",
  (e) => {
    const a = (e.target as Element | null)?.closest<HTMLAnchorElement>('a[href^="#"]');
    if (!a || scrollLocked) return;
    const id = a.getAttribute("href")!;
    const target = id === "#top" || id === "#" ? $("#top") : $(id);
    if (!target) return;
    e.preventDefault();
    lenis.scrollTo(target, { immediate: reduced(), duration: 1.6 });
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    history.replaceState(null, "", id);
  },
  { signal },
);

// ============================================================================
// 2. DOM 側のモジュール（GL の有無に関係なく動く）
// ============================================================================
const chapters = new Chapters();
const manifestoEl = $(".js-manifesto");
const manifesto = manifestoEl ? new Manifesto(manifestoEl) : null;
const pinQuery = matchMedia("(min-width: 901px)");
const galleryEl = $(".js-gallery");
const gallery = galleryEl ? new Gallery(galleryEl, () => pinQuery.matches && !reduced()) : null;

const cursorEl = $(".cursor");
const cursor = cursorEl && FINE_POINTER && !reduced() ? new Cursor(cursorEl, signal) : null;

// スクロールで現れる DOM の文字
const revealIO = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("is-in");
      revealIO.unobserve(e.target);
    }
  },
  { rootMargin: "0px 0px -12% 0px" },
);
$$("[data-reveal]").forEach((el) => revealIO.observe(el));

let hero: HeroTitle | null = null;
const intro = new Intro($(".loader")!, {
  reduced,
  onReveal: () => {
    document.body.classList.remove("is-loading");
    document.body.classList.add("is-ready");
    // 本文が見えるようになってから測り直す（visibility の切り替えでは寸法は変わらないが、
    // フォント適用後の最終レイアウトをここで確定させる）
    relayout();
    hero?.reveal();
  },
  onDone: () => {
    scrollLocked = false;
    lenis.start();
    $(".loader")?.setAttribute("aria-hidden", "true");
  },
});

/** レイアウトに依存する計測をまとめてやり直す。ギャラリーの高さが他の位置を動かすので先に測る */
function relayout() {
  gallery?.measure();
  manifesto?.measure();
  chapters.measure();
  lenis.resize();
}

let resizeTimer = 0;
window.addEventListener(
  "resize",
  () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(relayout, 120);
  },
  { signal },
);
pinQuery.addEventListener("change", relayout, { signal });

// 動きの抑制を途中で切り替えた時も、静的な構成へ移る
reducedMotionQuery.addEventListener(
  "change",
  () => {
    lenis.options.smoothWheel = !reduced();
    relayout();
  },
  { signal },
);

// ============================================================================
// 3. DomSyncGL
// ============================================================================
async function createApp(): Promise<DomSyncGL | null> {
  let stats: Stats | undefined;
  let gui: GUI | undefined;
  if (DEBUG) {
    const { default: StatsCtor } = await import("stats.js");
    stats = new StatsCtor();
    stats.showPanel(0);
    document.body.appendChild(stats.dom);
    const { default: GUICtor } = await import("lil-gui");
    gui = new GUICtor({ title: "HALATION debug" });
  }

  let app: DomSyncGL | null = null;
  try {
    app = new DomSyncGL("#gl", {
      // trackStrength: スクロール速度 strength を仕上げパスの色収差に使う
      scrollSync: { trackStrength: true },
      maxPixelRatio: MAX_DPR,
      autoRaf: false,
      stats,
      gui,
      // ?backend=webgl で WebGL 2 フォールバックを確認できる
      forceWebGL: new URLSearchParams(location.search).get("backend") === "webgl",
    });
    await app.ready;
    return app;
  } catch (err) {
    // WebGPU も WebGL 2 も使えない: DOM だけで読める構成に倒す
    console.warn("[HALATION] GL を初期化できないため DOM のみで表示します。", err);
    app?.destroy();
    document.documentElement.classList.add("no-gl");
    return null;
  }
}

/** ページで使うフォントを先に読む（DomTextPlane と Canvas 2D の図版が正しい字形で焼けるように） */
function loadFonts(): Promise<void> {
  const fonts = document.fonts;
  if (!fonts) return Promise.resolve();
  const faces = [
    '400 100px "Instrument Serif"',
    'italic 400 100px "Instrument Serif"',
    '500 16px "JetBrains Mono"',
    '400 16px "Inter Tight"',
    '400 16px "Zen Old Mincho"',
  ];
  const all = Promise.all(faces.map((f) => fonts.load(f))).then(() => fonts.ready);
  // フォント配信が遅い・落ちている時も 4 秒で先へ進む（fallback の字形で焼く）
  const timeout = new Promise((resolve) => window.setTimeout(resolve, 4000));
  return Promise.race([all, timeout]).then(
    () => undefined,
    () => undefined,
  );
}

// ============================================================================
// 4. 1 本の rAF ループ
// ============================================================================
let app: DomSyncGL | null = null;
let finish: FinishEffect | null = null;
const parts: Part[] = [];
let velocity = 0;
let speed = 0;
let last = performance.now();
let rafId = 0;

// 動きの抑制中は時計を止め、見栄えのよい瞬間（14 秒時点）で静止させる
shared.uClock.value = 14;

const frame = (time: number) => {
  rafId = requestAnimationFrame(frame);
  // タブ復帰時の巨大な dt をそのまま積まない
  const dt = Math.min(0.05, Math.max(0, (time - last) / 1000));
  last = time;
  const still = reduced();

  lenis.raf(time);
  const scrollY = window.scrollY;
  const vh = window.innerHeight;

  // --- DOM（GL が板の位置を読む前に書く） ---
  intro.update(dt);
  gallery?.update(scrollY);
  manifesto?.update(scrollY, vh, still);
  chapters.update(scrollY, vh);
  cursor?.update(dt);

  // --- 共有 uniform ---
  if (!still) shared.uClock.value += dt;
  // 符号付き速度は Lenis、速さの大きさはライブラリの scrollSync.strength から取る
  const vTarget = still ? 0 : Math.max(-1, Math.min(1, (lenis.velocity || 0) / 55));
  velocity = damp(velocity, vTarget, 7, dt);
  shared.uVelocity.value = velocity;
  const strength = still ? 0 : (app?.getScrollSync()?.strength ?? 0);
  speed = damp(speed, strength, 8, dt);
  shared.uSpeed.value = speed;
  if (app && app.isPointerActive() && !COARSE) {
    const m = app.getMouse();
    const p = shared.uPointer.value;
    p.set(damp(p.x, m.x, 2.5, dt), damp(p.y, m.y, 2.5, dt));
  }
  for (const part of parts) part.update(dt);

  // --- GL ---
  app?.tick(time);
};
rafId = requestAnimationFrame(frame);

// ============================================================================
// 5. GL シーンの構築（フォントと GL の準備を待ってから）
// ============================================================================
const [readyApp] = await Promise.all([createApp(), loadFonts()]);
app = readyApp;
relayout();

if (app) {
  const gl = app;
  const hoverable = FINE_POINTER;

  parts.push(createBackground(gl, OCTAVES));

  const heroEl = $(".js-hero-title");
  if (heroEl) {
    hero = createHeroTitle(gl, heroEl, reduced);
    parts.push(hero);
  }

  const flareEl = $(".js-flare");
  if (flareEl && manifesto) {
    parts.push(createManifestoFlare(gl, flareEl, () => manifesto.progress));
  }

  parts.push(
    createExhibits(gl, $$(".js-exhibit-art"), {
      octaves: OCTAVES,
      reduced,
      hoverable,
      // 湾曲は横方向だけなので縦は粗くてよいが、PlaneGeometry は縦横同数になる
      segments: COARSE ? 12 : 24,
    }),
  );

  const visual = $(".js-process-visual");
  if (visual) {
    parts.push(
      createProcess(gl, visual, $$<HTMLButtonElement>(".js-stage"), $(".js-stage-caption"), {
        reduced,
        signal,
      }),
    );
  }

  parts.push(createFigures(gl, $$(".js-figure"), reduced));

  const visitEl = $(".js-visit-title");
  if (visitEl) {
    parts.push(createVisitTitle(gl, visitEl, { reduced, interactive: hoverable && !reduced() }));
  }

  // 仕上げパスは最後に繋ぐ（チェーンの末尾 = 画面に出る直前）
  finish = gl.addEffect(new FinishEffect());
  intro.attach(finish);
  // 1 フレーム描いてから DOM の黒をやめて GL の光漏れを透かす
  requestAnimationFrame(() => requestAnimationFrame(() => intro.handOver()));

  if (DEBUG) (window as unknown as { app: DomSyncGL }).app = gl;
} else {
  // GL なし: 段階ボタンは文言と状態だけ切り替える
  const buttons = $$<HTMLButtonElement>(".js-stage");
  const caption = $(".js-stage-caption");
  buttons.forEach((b, i) =>
    b.addEventListener(
      "click",
      () => {
        buttons.forEach((o, k) => o.setAttribute("aria-pressed", String(k === i)));
        if (caption) caption.textContent = CAPTIONS[i];
      },
      { signal },
    ),
  );
}

intro.setAssetsReady();

// ============================================================================
// 6. 破棄（bfcache に載る遷移では壊さない）
// ============================================================================
window.addEventListener(
  "pagehide",
  (e) => {
    if (e.persisted) return;
    cancelAnimationFrame(rafId);
    window.clearTimeout(resizeTimer);
    lifetime.abort();
    revealIO.disconnect();
    cursor?.destroy();
    for (const part of parts) part.destroy?.();
    parts.length = 0;
    lenis.destroy();
    app?.destroy();
    app = null;
  },
  { signal },
);
