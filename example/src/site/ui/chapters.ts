/**
 * 章の追跡。スクロール位置から「いまどの章か」と「章と章の間の補間量」を求め、
 * ナビの章表示・進捗バー・背景の色（共有 uniform）を更新する。
 *
 * 章の上端はリサイズ時にだけ測ってキャッシュし、毎フレームは scrollY との
 * 比較だけで済ませる（毎フレーム getBoundingClientRect を呼ばない）。
 */
import { THREE } from "dom-sync-gl";
import { clamp01 } from "../env";
import { shared } from "../uniforms";

interface Mood {
  keyA: string;
  keyB: string;
  counter: string;
}

// 章ごとの光の色。00 と 05 がいちばん暖かく、02（作品）で少し白く冷える。
const MOODS: Mood[] = [
  { keyA: "#ff6a1f", keyB: "#ffd9a0", counter: "#4fc8d8" }, // 00 Prologue
  { keyA: "#d9481c", keyB: "#ffc58a", counter: "#3aa6c0" }, // 01 Manifesto
  { keyA: "#ff8a3d", keyB: "#fff0d6", counter: "#6fe0ee" }, // 02 Exhibits
  { keyA: "#ffa640", keyB: "#ffe2a8", counter: "#4fb8c8" }, // 03 Process
  { keyA: "#ff7a2e", keyB: "#ffd9a0", counter: "#5fd3e0" }, // 04 Figures
  { keyA: "#ff4a14", keyB: "#ffb070", counter: "#3fb0c0" }, // 05 Visit
];
const moodColors = MOODS.map((m) => ({
  keyA: new THREE.Color(m.keyA),
  keyB: new THREE.Color(m.keyB),
  counter: new THREE.Color(m.counter),
}));

const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

export class Chapters {
  private readonly sections: HTMLElement[];
  private tops: number[] = [];
  private maxScroll = 1;
  private active = -1;
  private readonly noEl: HTMLElement | null;
  private readonly nameEl: HTMLElement | null;
  private readonly barEl: HTMLElement | null;
  private readonly links: HTMLAnchorElement[];

  constructor() {
    this.sections = Array.from(document.querySelectorAll<HTMLElement>("[data-chapter]"));
    this.noEl = document.querySelector(".js-chapter-no");
    this.nameEl = document.querySelector(".js-chapter-name");
    this.barEl = document.querySelector(".js-progress");
    this.links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".nav__menu a"));
    this.measure();
  }

  /** レイアウトが変わるたび（resize・フォント適用・ギャラリーの高さ変更後）に呼ぶ */
  measure(): void {
    const y = window.scrollY;
    this.tops = this.sections.map((s) => s.getBoundingClientRect().top + y);
    this.maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  }

  update(scrollY: number, vh: number): void {
    // 画面の中ほど（55%）を基準に章を判定する
    const probe = scrollY + vh * 0.55;
    let i = 0;
    for (let k = 0; k < this.tops.length; k++) {
      if (probe >= this.tops[k]) i = k;
    }
    const next = Math.min(i + 1, this.tops.length - 1);
    const span = Math.max(1, (this.tops[next] ?? this.tops[i]) - this.tops[i]);
    const frac = next === i ? 0 : clamp01((probe - this.tops[i]) / span);
    // 章の終わり 3 割でだけ次の色へ移る（章の中では色を保つ）
    const blend = smooth(0.7, 1.0, frac);

    const a = moodColors[Math.min(i, moodColors.length - 1)];
    const b = moodColors[Math.min(next, moodColors.length - 1)];
    shared.uKeyA.value.copy(a.keyA).lerp(b.keyA, blend);
    shared.uKeyB.value.copy(a.keyB).lerp(b.keyB, blend);
    shared.uCounter.value.copy(a.counter).lerp(b.counter, blend);

    // ヒーローで最大、下の章では沈める。最後の章（Visit）は少し灯し直す
    const hero = 1 - smooth(0, vh * 0.95, scrollY);
    const lastIndex = this.tops.length - 1;
    const visit = i === lastIndex ? 1 : i === lastIndex - 1 ? blend : 0;
    shared.uHero.value = Math.max(hero, visit * 0.55);
    shared.uScroll.value = scrollY / Math.max(1, vh);

    if (this.barEl) {
      this.barEl.style.transform = `scaleX(${clamp01(scrollY / this.maxScroll).toFixed(4)})`;
    }
    if (i !== this.active) {
      this.active = i;
      const sec = this.sections[i];
      if (this.noEl) this.noEl.textContent = sec.dataset.chapter ?? "";
      if (this.nameEl) this.nameEl.textContent = sec.dataset.name ?? "";
      const id = `#${sec.id}`;
      for (const link of this.links) {
        if (link.getAttribute("href") === id) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      }
    }
  }
}
