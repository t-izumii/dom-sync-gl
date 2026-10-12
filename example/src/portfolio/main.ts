import Lenis from 'lenis';
import './style.css';
import type { SculptureStage } from './surface';
import { ScrollStudio } from './studio';

const lifetime = new AbortController();
const { signal } = lifetime;
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const fine = matchMedia('(hover: hover) and (pointer: fine)');
const dialog = document.querySelector<HTMLDialogElement>('.project-dialog')!;
const progress = document.querySelector<HTMLElement>('.reading-progress')!;
const lenis = new Lenis({ autoRaf: false, smoothWheel: !motion.matches && fine.matches, syncTouch: false, lerp: .085 });
let surfaces: SculptureStage | null = null;
let gpuGeneration = 0;
const studio = new ScrollStudio(() => motion.matches, top => lenis.scrollTo(top,{duration:.85,immediate:motion.matches,force:true}));
let raf = 0;
let last = performance.now();
let currentProject = '';
let trigger: HTMLElement | null = null;
let disposed = false;

const projects = {
  fold: { title: 'Fold', subtitle: 'The shape of a touch.', image: 'fold', alt: '朱色の光が反射する銀色のループ彫刻', medium: 'Three.js / TSL / Live sculpture', description: '硬い金属に、柔らかな反応を。ループの立体をTSLで呼吸させるConceptです。dom-sync-glのcreate3DObjectが、CSSで決めた枠と立体の位置を同期します。ドラッグで回転し、Transformで輪郭がほどける。背後の光の軌道はDOM枠から独立した空間にあり、スクロールがふたつの層をつないでいます。', next: 'echo' },
  echo: { title: 'Echo', subtitle: 'A rhythm you can see.', image: 'echo', alt: '銀と朱色の細い同心円が浮かぶ淡い青灰色の空間', medium: '23 meshes / DOM sync / Recomposition', description: '23の輪郭から、ひとつの形へ。反復と分解のリズムを探るConceptです。Transformを押すと輪が空間にほどけ、もう一度押すと集まります。横へ流れるDOMの章に立体が正確に追従し、独立した光の軌道がその背後を横断します。タッチでもキーボードでも同じ変化を体験できます。', next: 'matter' },
  matter: { title: 'Matter', subtitle: 'Order, with room to play.', image: 'matter', alt: '朱色の薄板が波のように連なる立体', medium: 'Generative form / DOM ↔ WebGL', description: '39枚の薄板に、波の規則を与える。繰り返しから柔らかさが現れるConceptです。Transformで振幅が大きくなり、指先で角度を変えられます。画面のレイアウトはDOM、立体の形はGPUが担当。見えている作品だけを描画し、動きを抑える設定では静止した縦の章へ切り替わります。', next: 'fold' },
} as const;
type ProjectId = keyof typeof projects;

function syncRoute() {
  const id = location.hash.replace('#project-', '') as ProjectId;
  if (location.hash.startsWith('#project-') && id in projects) {
    const project = projects[id];
    if (currentProject !== id) {
      document.querySelector('#project-title')!.textContent = project.title;
      document.querySelector('#project-subtitle')!.textContent = project.subtitle;
      document.querySelector('#project-description')!.textContent = project.description;
      document.querySelector('#project-medium')!.textContent = project.medium;
      const img = document.querySelector<HTMLImageElement>('#project-image')!;
      img.src = `/portfolio/${project.image}.png`; img.alt = project.alt;
      const next = document.querySelector<HTMLAnchorElement>('#project-next')!;
      next.href = `#project-${project.next}`; next.dataset.project = project.next;
      next.textContent = `Next study: ${projects[project.next].title} →`;
      currentProject = id;
      dialog.scrollTop = 0;
    }
    if (!dialog.open) {
      lenis.stop();
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>('button')?.focus();
    }
  } else if (dialog.open) {
    dialog.close(); currentProject = '';
    lenis.start(); surfaces?.resize();
    trigger?.focus({ preventScroll: true }); trigger = null;
  }
  surfaces?.invalidate();
}

function closeProject() {
  if (history.state?.portfolioDialog) history.back();
  else {
    history.replaceState(null, '', location.pathname + location.search + '#work');
    syncRoute();
  }
}

document.addEventListener('click', event => {
  const target = event.target as Element | null;
  const transform = target?.closest<HTMLButtonElement>('[data-transform]');
  if (transform) {
    const scene = document.getElementById(transform.dataset.transform!);
    if (scene && !scene.classList.contains('is-gl')) {
      const on = transform.getAttribute('aria-pressed') !== 'true';
      transform.setAttribute('aria-pressed', String(on)); scene.dataset.transformed = String(on);
    }
  }
  const link = target?.closest<HTMLAnchorElement>('a[data-project]');
  if (link && !event.defaultPrevented && !(event as MouseEvent).metaKey && !(event as MouseEvent).ctrlKey && !(event as MouseEvent).shiftKey && (event as MouseEvent).button === 0) {
    event.preventDefault();
    if (!dialog.open) trigger = link;
    // The detail switch replaces its entry so one Back always returns to the page.
    if (dialog.open) history.replaceState(history.state, '', link.getAttribute('href'));
    else history.pushState({ portfolioDialog: true }, '', link.getAttribute('href'));
    syncRoute();
    return;
  }
  const anchor = target?.closest<HTMLAnchorElement>('a[href^="#"]');
  if (anchor && !anchor.dataset.project) {
    const id = anchor.getAttribute('href')!.slice(1);
    const section = document.getElementById(id);
    if (!section) return;
    // Native fragment navigation preserves browser history; add accessible focus.
    requestAnimationFrame(() => section.focus({ preventScroll: true }));
  }
}, { signal });
dialog.querySelector('button')!.addEventListener('click', closeProject, { signal });
dialog.addEventListener('cancel', event => { event.preventDefault(); closeProject(); }, { signal });
dialog.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')).filter(element => element.getClientRects().length > 0);
  const first = controls[0], lastControl = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); lastControl?.focus(); }
  else if (!event.shiftKey && document.activeElement === lastControl) { event.preventDefault(); first?.focus(); }
}, { signal });
dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeProject(); } }, { signal });
dialog.addEventListener('wheel', event => event.stopPropagation(), { signal });
dialog.addEventListener('touchmove', event => event.stopPropagation(), { signal });
window.addEventListener('hashchange', syncRoute, { signal });
window.addEventListener('popstate', syncRoute, { signal });

document.querySelectorAll<HTMLImageElement>('.art img, #project-image').forEach(img => {
  img.addEventListener('error', () => { img.closest('.art')?.classList.add('image-error'); }, { signal });
  if (img.complete && img.naturalWidth === 0) img.closest('.art')?.classList.add('image-error');
});
document.querySelectorAll<HTMLElement>('.art').forEach(art => {
  const cursor = art.querySelector<HTMLElement>('.art-cursor')!;
  art.addEventListener('pointermove', event => {
    if (motion.matches || !fine.matches) return;
    const r = art.getBoundingClientRect();
    cursor.style.left = `${event.clientX - r.left}px`; cursor.style.top = `${event.clientY - r.top}px`;
    surfaces?.invalidate();
  }, { signal, passive: true });
  art.addEventListener('pointerleave', () => surfaces?.invalidate(), { signal });
  art.addEventListener('focus', () => surfaces?.invalidate(), { signal });
  art.addEventListener('blur', () => surfaces?.invalidate(), { signal });
});

function frame(time: number) {
  raf = 0;
  if (disposed || document.hidden) return;
  const dt = Math.min(.05, Math.max(.001, (time - last) / 1000)); last = time;
  lenis.raf(time);
  const available = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  progress.style.transform = `scaleX(${Math.min(1, Math.max(0, scrollY / available))})`;
  const chapter = studio.update(time);
  surfaces?.update(time, dt, chapter);
  raf = requestAnimationFrame(frame);
}
function wake() { if (!disposed && !document.hidden && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
window.addEventListener('resize', () => { lenis.resize(); surfaces?.resize(); }, { signal, passive: true });
window.addEventListener('scroll', () => surfaces?.invalidate(), { signal, passive: true });
motion.addEventListener('change', () => { lenis.options.smoothWheel = !motion.matches && fine.matches; surfaces?.syncMotion(); wake(); }, { signal });
fine.addEventListener('change', () => { lenis.options.smoothWheel = !motion.matches && fine.matches; surfaces?.syncMotion(); }, { signal });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(raf); raf = 0; lenis.stop(); }
  else { if (!dialog.open) lenis.start(); surfaces?.resize(); wake(); }
}, { signal });

// bfcache keeps the DOM/JS heap; release GPU objects on pagehide and recreate on pageshow.
function releaseGPU() { gpuGeneration++; surfaces?.destroy(); surfaces = null; }
async function startGPU() {
  if (disposed || surfaces || new URLSearchParams(location.search).has('no-gl')) {
    if (!surfaces) {
      document.documentElement.dataset.portfolioRenderer = 'dom';
      document.documentElement.dataset.portfolioPhase = 'fallback';
      document.documentElement.dataset.portfolioFallbackReason = 'URLのno-gl指定で画像表示を選択しています。';
    }
    return;
  }
  const generation = ++gpuGeneration;
  document.documentElement.dataset.portfolioPhase = 'loading';
  delete document.documentElement.dataset.portfolioFallbackReason;
  let instance: SculptureStage | null = null;
  try {
    const { SculptureStage } = await import('./surface');
    if (disposed || generation !== gpuGeneration) return;
    instance = new SculptureStage(() => motion.matches, wake);
    surfaces = instance;
    await instance.init();
  } catch (error) {
    console.warn('[Portfolio] DOM fallback:', error);
    if (generation === gpuGeneration && (!instance || surfaces === instance)) {
      surfaces = null;
      document.documentElement.dataset.portfolioRenderer = 'dom';
      document.documentElement.dataset.portfolioPhase = 'fallback';
      document.documentElement.dataset.portfolioFallbackReason = `3Dの初期化に失敗しました: ${error instanceof Error ? error.message : String(error)}`;
      for (const id of ['portfolio-gl','portfolio-work-gl','portfolio-space']) document.getElementById(id)?.replaceChildren();
    }
  }
  wake();
}
window.addEventListener('portfolio-retry-gpu', () => { releaseGPU(); void startGPU(); wake(); }, { signal });
window.addEventListener('pagehide', event => {
  cancelAnimationFrame(raf); raf = 0; releaseGPU(); lenis.stop();
  if (!event.persisted) { disposed = true; lifetime.abort(); studio.destroy(); lenis.destroy(); }
}, { signal });
window.addEventListener('pageshow', event => {
  if (event.persisted) { if (!dialog.open) lenis.start(); syncRoute(); void startGPU(); wake(); }
}, { signal });
if (import.meta.hot) import.meta.hot.dispose(() => { disposed = true; cancelAnimationFrame(raf); releaseGPU(); lifetime.abort(); studio.destroy(); lenis.destroy(); });
syncRoute();
wake();
void startGPU();
