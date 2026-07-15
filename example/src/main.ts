import { DomSyncGL, THREE, loadFont } from "dom-sync-gl";
import Lenis from "lenis";
import type Stats from "stats.js";
import type GUI from "lil-gui";
import "lenis/dist/lenis.css";
import { heroFragment, workFragment } from "./shaders";
import { FilmEffect, TextHoverEffect } from "./effects";
import "./style.css";

// ============================================================================
// 環境フラグ（パフォーマンス / アクセシビリティの分岐）
// ============================================================================
const REDUCE_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;
const FINE_POINTER = matchMedia("(pointer: fine)").matches;
const COARSE = matchMedia("(pointer: coarse)").matches;
const MAX_DPR = COARSE ? 1.5 : 2;

const lerp = (cur: number, to: number, k: number) => cur + (to - cur) * k;

// ============================================================================
// 1. スムーズスクロール（Lenis）は layout の関心事。ライブラリは持たないのでここで初期化する。
//    autoRaf は使わず、rAF は下の 1 本のループが所有する（順序を仕組みで保証）。
// ============================================================================
const lenis = new Lenis({
  autoRaf: false,
  smoothWheel: !REDUCE_MOTION,
  syncTouch: false,
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) lenis.stop();
  else lenis.start();
});

// ============================================================================
// 2. DomSyncGL
//    autoRaf: false ＝ 内部 rAF を止め、下のループから app.tick() で駆動する。
//    stats.js / lil-gui はライブラリが持たない。使うかどうか・生成・DOM 挿入・
//    破棄はすべて呼び出し元（ここ）の責務で、インスタンスを渡すだけ。
// ============================================================================
let stats: Stats | undefined;
let gui: GUI | undefined;
if (import.meta.env?.DEV) {
  const { default: StatsCtor } = await import("stats.js");
  stats = new StatsCtor();
  stats.showPanel(0);
  document.body.appendChild(stats.dom);

  const { default: GUICtor } = await import("lil-gui");
  gui = new GUICtor({ title: "Effects" });
}

const app = new DomSyncGL("#gl", {
  // trackStrength: スクロール速度 strength を演出に流し込むので有効化する。
  //   （false のままだと strength は常に 0 で、DEV では警告が出る）
  // overscan: 'auto' — coarse pointer では URL バーの伸縮で viewport 高が変わるため、
  //   上下に余白を持たせて縁が欠けるのを防ぐ。fine pointer では 0（＝オーバーヘッドなし）。
  scrollSync: { trackStrength: true, overscan: "auto" },
  maxPixelRatio: MAX_DPR,
  autoRaf: false,
  stats,
  gui,
});

// 1 本の rAF で「Lenis → DomSyncGL」の順に駆動する。
// lenis.raf() でスクロールを確定させた後に app.tick() が読むので、
// 背景固定・DOM 追従の両方が同一フレームで同期する（ジッターが出ない）。
const raf = (time: number) => {
  lenis.raf(time);
  app.tick(time);
  requestAnimationFrame(raf);
};
requestAnimationFrame(raf);

const scrollSync = app.getScrollSync();

// ============================================================================
// 3. ヒーローのフルスクリーン背景 plane（viewport 固定）
//    DOM は透明にして canvas を覗かせる構成なので、これがページ全体の地になる。
//    uTime / uResolution / uMouseUV は DomPlane が自動更新する。uStrength だけ手動。
// ============================================================================
const heroPlane = app.createPlane(null, {
  fragmentShader: heroFragment,
  uniforms: {
    uStrength: { value: 0 },
  },
});
// 背景は常に最背面。works の板を必ず上に重ねたいので renderOrder と深度設定で制御する。
heroPlane.getMesh().renderOrder = -10;
heroPlane.material.depthTest = false;
heroPlane.material.depthWrite = false;

// ============================================================================
// 4. Works — 各 .work__visual を DOM にロックした procedural な板にする
// ============================================================================
type WorkState = {
  el: HTMLElement;
  plane: ReturnType<DomSyncGL["createPlane"]>;
  hover: number;
  hoverTarget: number;
  reveal: number;
  revealTarget: number;
};

// 水墨のトーン。各 work は [濃い墨, 淡いトーン] の単色ベースで諧調を作る。
const palettes: [number, number][] = [
  [0x2a2722, 0xd8d2c6], // 暖墨 → 生成り
  [0x23282b, 0xccd0cb], // 青墨 → 霧
  [0x2b2620, 0xd9cdb6], // 焦茶 → 砂色
  [0x21282b, 0xc6cecd], // 鉄紺 → 淡藍
  [0x2c2622, 0xd4c8b6], // 墨 → 白茶
];

const works: WorkState[] = [];

document.querySelectorAll<HTMLElement>(".work").forEach((workEl, i) => {
  const visual = workEl.querySelector<HTMLElement>(".work__visual");
  if (!visual) return;

  const [a, b] = palettes[i % palettes.length];

  const plane = app.createPlane(visual, {
    fragmentShader: workFragment,
    updateRectEveryFrame: true, // sticky/CSS で動いても追従させる
    inViewRepeat: true,
    inViewRootMargin: "0px",
    uniforms: {
      uHover: { value: 0 },
      uReveal: { value: 0 },
      uStrength: { value: 0 },
      uColorA: { value: new THREE.Color(a) },
      uColorB: { value: new THREE.Color(b) },
      uSeed: { value: i * 1.37 + 0.21 },
    },
    onInView: () => (state.revealTarget = 1),
    onOutView: () => (state.revealTarget = 0),
  });
  // 背景シェーダーの上に必ず描く
  plane.getMesh().renderOrder = i + 1;
  plane.material.depthTest = false;
  plane.material.depthWrite = false;

  const state: WorkState = {
    el: workEl,
    plane,
    hover: 0,
    hoverTarget: 0,
    reveal: 0,
    revealTarget: 0,
  };

  // ホバー量は DOM の pointer で取る（CSS の is-hover と 1 つの状態で揃うので）。
  // uMouseUV は PointerController が raycast して毎フレーム更新するため、ここでは触らない。
  workEl.addEventListener("pointerenter", () => {
    state.hoverTarget = 1;
    workEl.classList.add("is-hover");
  });
  workEl.addEventListener("pointerleave", () => {
    state.hoverTarget = 0;
    workEl.classList.remove("is-hover");
  });

  works.push(state);
});

// ============================================================================
// 5. DomTextPlane デモ — テキストレイヤーも WebGL 管理下に置く
// ============================================================================
const textDemoEl = document.querySelector<HTMLElement>(".text-plane-demo");
if (textDemoEl) {
  const textPlane = app.createTextPlane(textDemoEl, {
    updateRectEveryFrame: true,
  });
  if (import.meta.env?.DEV) {
    (window as unknown as { textPlane: typeof textPlane }).textPlane = textPlane;
  }
}

// フォント動的ロードのデモ — フォントの取得・登録は DomTextPlane の責務ではなく
// 独立ユーティリティ loadFont() の責務。取得（loadFont の呼び出し）と利用（それを
// 待ってから createTextPlane を呼ぶ箇所）を分離し、Promise を変数にキャッシュしておく。
// こうすると同じフォントを複数箇所で使う場合も、loadFont() 自身の重複フェッチ防止に
// 加えて、呼び出し側は毎回同じ FontFaceSource を組み立て直す必要がなく確実に同じ
// ロード結果を共有できる。
// CSS 側（.text-plane-fontface-demo）で font-family: "DemoSpaceMono" を指定してあり、
// font-size は clamp() の fluid 値（＝常に getComputedStyle 由来）で解決される。
// URL は差し替え可能（woff2/woff/ttf の直リンク or CSS の url()/format() 構文）。
// 下記は Google Fonts が配布する Space Mono（latin サブセット）の woff2 直リンク。
// gstatic の URL は再ビルドで v14 → v17 のようにバージョンが上がって古い URL が 404 に
// なるので、切れたら fonts.googleapis.com/css2?family=Space+Mono の中身を見て貼り直す。
// ネットワークに依存するため、オフライン確認時は任意のローカル woff2 に差し替えてよい。
// loadFont() は失敗しても reject せず warn するだけなので、落ちてもページは壊れず
// CSS の fallback（ui-monospace）で描画される。
const demoSpaceMonoReady = loadFont({
  family: "DemoSpaceMono",
  url: "https://fonts.gstatic.com/s/spacemono/v17/i7dPIFZifjKcF5UAWdDRYEF8RXi4EwQ.woff2",
  weight: "400",
  style: "normal",
});

const fontFaceDemoEl = document.querySelector<HTMLElement>(".text-plane-fontface-demo");
if (fontFaceDemoEl) {
  demoSpaceMonoReady.then(() => {
    const fontFacePlane = app.createTextPlane(fontFaceDemoEl, {
      updateRectEveryFrame: true,
    });

    // 動作確認用ホバー post effect。plane.isHovered() は PointerController が
    // 自動でヒットテストして更新するので、DOM 側の pointerenter/leave は不要。
    const textHover = new TextHoverEffect();
    fontFacePlane.addEffect(textHover);
    let textHoverValue = 0;
    app.addUpdateCallback(() => {
      const target = fontFacePlane.isHovered() ? 1 : 0;
      textHoverValue = lerp(textHoverValue, target, 0.15);
      textHover.setHover(textHoverValue);
    });
  });
}

// ============================================================================
// 6. 仕上げ post effect（色収差 + グレイン + ビネット）
// ============================================================================
const film = new FilmEffect();
app.addEffect(film);
const syncEffectSize = () => film.setResolution(window.innerWidth, window.innerHeight);
syncEffectSize();
app.addResizeCallback(syncEffectSize);

// ============================================================================
// 7. 毎フレーム更新
// ============================================================================
let strength = 0;
const EPS = 0.0005;

app.addUpdateCallback(() => {
  // スクロール速度（0..1）を緩めて伝播
  const target = scrollSync ? scrollSync.strength : 0;
  strength = lerp(strength, target, 0.25);
  if (strength < EPS) strength = 0;

  heroPlane.material.uniforms.uStrength.value = strength;
  film.setStrength(strength);

  for (const w of works) {
    w.hover = lerp(w.hover, w.hoverTarget, 0.12);
    w.reveal = lerp(w.reveal, w.revealTarget, 0.08);
    w.plane.material.uniforms.uHover.value = w.hover;
    w.plane.material.uniforms.uReveal.value = w.reveal;
    w.plane.material.uniforms.uStrength.value = strength;
  }
});

// レイアウト確定後に板の rect を取り直す（フォント適用・プリローダー解除のズレ対策）
const refreshLayout = () => window.dispatchEvent(new Event("resize"));
if (document.fonts?.ready) document.fonts.ready.then(refreshLayout);

// ============================================================================
// 8. DOM スクロールリビール（テキスト類）
// ============================================================================
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add("is-in");
        io.unobserve(e.target);
      }
    }
  },
  { rootMargin: "0px 0px -12% 0px" }
);
document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));

// ============================================================================
// 9. カスタムカーソル
// ============================================================================
const cursor = document.querySelector<HTMLElement>(".cursor");
if (cursor && FINE_POINTER && !REDUCE_MOTION) {
  // 自前カーソルを使う時だけネイティブカーソルを隠す（CSS の body.custom-cursor）
  document.body.classList.add("custom-cursor");
  let cx = window.innerWidth / 2;
  let cy = window.innerHeight / 2;
  let tx = cx;
  let ty = cy;
  let cursorRaf = 0;

  window.addEventListener(
    "pointermove",
    (e) => {
      tx = e.clientX;
      ty = e.clientY;
    },
    { passive: true }
  );
  document.querySelectorAll("a, button, .work").forEach((el) => {
    el.addEventListener("pointerenter", () => cursor.classList.add("is-active"));
    el.addEventListener("pointerleave", () => cursor.classList.remove("is-active"));
  });

  const renderCursor = () => {
    cx = lerp(cx, tx, 0.18);
    cy = lerp(cy, ty, 0.18);
    cursor.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`;
    cursorRaf = requestAnimationFrame(renderCursor);
  };
  renderCursor();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(cursorRaf);
      cursorRaf = 0;
    } else if (!cursorRaf) {
      renderCursor();
    }
  });
} else if (cursor) {
  cursor.remove();
}

// ============================================================================
// 10. プリローダー
// ============================================================================
const loader = document.querySelector<HTMLElement>(".loader");
const counter = document.querySelector<HTMLElement>(".loader__count");
if (loader && counter) {
  let n = 0;
  const tick = () => {
    n = Math.min(100, n + Math.ceil((100 - n) * 0.06) + 1);
    counter.textContent = String(n).padStart(3, "0");
    if (n < 100) {
      requestAnimationFrame(tick);
    } else {
      loader.classList.add("is-done");
      document.body.classList.add("is-ready");
      refreshLayout();
      setTimeout(() => loader.remove(), 900);
    }
  };
  requestAnimationFrame(tick);
} else {
  document.body.classList.add("is-ready");
}

if (import.meta.env?.DEV) {
  (window as unknown as { app: DomSyncGL }).app = app;
}
