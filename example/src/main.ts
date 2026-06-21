import { DomSyncGL, THREE } from "dom-sync-gl";
import { heroFragment, workFragment } from "./shaders";
import { FilmEffect } from "./effects";
import "./style.css";

// ---------------------------------------------------------------------------
// 1. DomSyncGL 初期化
//    scrollSync / rafScroll はどちらもオプション省略 (= true) でデフォルト構成にしている。
//    rafScroll は Lenis ベースのスムーズスクロールを Core 管理下で有効化し、
//    Core の単一 rAF ループ内で raf 駆動 → scroll 読み取りの順に動かすので、
//    生成順を気にせず背景 canvas が 1 フレームずれない。
//    （スクロール速度 strength を演出に使いたい場合のみ scrollSync: { trackStrength: true } にする）
// ---------------------------------------------------------------------------
const app = new DomSyncGL("#gl", {
  scrollSync: true,
  rafScroll: true,
  maxPixelRatio: 2,
  showGUI: false,
  showStats: true,
});

// ---------------------------------------------------------------------------
// 2. ヒーローのフルスクリーン背景 plane (viewport 固定)
// ---------------------------------------------------------------------------
const heroPlane = app.createPlane(null, {
  fragmentShader: `
  void main() {
    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
  }
  `,
});
// 背景は常に最背面。works の板を必ず上に重ねたいので renderOrder と深度設定で制御する。
// (DOM は透明にして canvas を覗かせる構成なので、背景シェーダーがページ全体の地になる)
heroPlane.getMesh().renderOrder = -10;
heroPlane.material.depthTest = false;
heroPlane.material.depthWrite = false;

// ---------------------------------------------------------------------------
// 3. Works — 各 .work__visual を DOM にロックした procedural な板にする
// ---------------------------------------------------------------------------
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

  // ホバーは raycast(uIsHovered) ではなく DOM の pointer で取る方が安定する。
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

// ---------------------------------------------------------------------------
// 4. 仕上げの post effect (色収差 + グレイン + ビネット)
// ---------------------------------------------------------------------------
const film = new FilmEffect();
app.addEffect(film);

const syncEffectSize = () => film.setResolution(window.innerWidth, window.innerHeight);
syncEffectSize();
app.addResizeCallback(syncEffectSize);

// ---------------------------------------------------------------------------
// 5. 毎フレーム: ホバー / リビールの lerp 更新
// ---------------------------------------------------------------------------
const lerp = (cur: number, to: number, k: number) => cur + (to - cur) * k;

app.addUpdateCallback(() => {
  for (const w of works) {
    w.hover = lerp(w.hover, w.hoverTarget, 0.12);
    w.reveal = lerp(w.reveal, w.revealTarget, 0.08);
    w.plane.material.uniforms.uHover.value = w.hover;
    w.plane.material.uniforms.uReveal.value = w.reveal;
  }
});

// ---------------------------------------------------------------------------
// 6. DOM のスクロールリビール (テキスト類)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// 7. カスタムカーソル
// ---------------------------------------------------------------------------
const cursor = document.querySelector<HTMLElement>(".cursor");
if (cursor && window.matchMedia("(pointer: fine)").matches) {
  let cx = window.innerWidth / 2;
  let cy = window.innerHeight / 2;
  let tx = cx;
  let ty = cy;

  window.addEventListener("pointermove", (e) => {
    tx = e.clientX;
    ty = e.clientY;
  });

  const interactive = "a, button, .work";
  document.querySelectorAll(interactive).forEach((el) => {
    el.addEventListener("pointerenter", () => cursor.classList.add("is-active"));
    el.addEventListener("pointerleave", () => cursor.classList.remove("is-active"));
  });

  const renderCursor = () => {
    cx = lerp(cx, tx, 0.18);
    cy = lerp(cy, ty, 0.18);
    cursor.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`;
    requestAnimationFrame(renderCursor);
  };
  renderCursor();
} else if (cursor) {
  cursor.remove();
}

// ---------------------------------------------------------------------------
// 8. プリローダー (カウンタ → fade out)
// ---------------------------------------------------------------------------
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
      setTimeout(() => loader.remove(), 900);
    }
  };
  requestAnimationFrame(tick);
}

// 開発時の確認用にグローバルへ
(window as unknown as { app: DomSyncGL }).app = app;
