/**
 * 展示ギャラリーの「縦スクロール → 横移動」変換。
 * セクションの高さを「横移動量 + 1 画面」にし、sticky で固定した中身の track を
 * スクロール量ぶん横へ送る。track の transform は main.ts のループで app.tick() より
 * 前に書くので、updateRectEveryFrame の板は同じフレームの位置を読む（ずれない）。
 *
 * 狭い画面と動きの抑制中は固定をやめ、縦に並べるだけにする（.is-static）。
 */
import { clamp01 } from "../env";

export class Gallery {
  private readonly track: HTMLElement;
  private readonly fill: HTMLElement | null;
  private readonly count: HTMLElement | null;
  private readonly items: number;
  private top = 0;
  private distance = 0;
  private pinned = false;
  private lastX = NaN;
  private lastIndex = -1;
  /** 0..1。ギャラリーを通過した割合（固定しない時は 0） */
  progress = 0;

  constructor(
    private readonly section: HTMLElement,
    private readonly shouldPin: () => boolean,
  ) {
    this.track = section.querySelector<HTMLElement>(".js-track")!;
    this.fill = section.querySelector(".js-gallery-fill");
    this.count = section.querySelector(".js-gallery-count");
    this.items = this.track.children.length;
    this.measure();
  }

  get isPinned(): boolean {
    return this.pinned;
  }

  /** レイアウトが変わるたびに呼ぶ。セクションの高さを変えるので、呼んだ後は他の計測もやり直す */
  measure(): void {
    this.pinned = this.shouldPin();
    this.section.classList.toggle("is-static", !this.pinned);
    this.lastX = NaN;
    if (!this.pinned) {
      this.section.style.height = "";
      this.track.style.transform = "";
      this.distance = 0;
      return;
    }
    // 右端の作品が画面の右余白に収まるところまで送る
    this.distance = Math.max(0, this.track.scrollWidth - window.innerWidth);
    this.section.style.height = `${this.distance + window.innerHeight}px`;
    this.top = this.section.getBoundingClientRect().top + window.scrollY;
  }

  update(scrollY: number): void {
    if (!this.pinned) return;
    this.progress = this.distance > 0 ? clamp01((scrollY - this.top) / this.distance) : 0;
    const x = Math.round(this.progress * this.distance * 10) / 10;
    if (x !== this.lastX) {
      this.lastX = x;
      this.track.style.transform = `translate3d(${-x}px, 0, 0)`;
      if (this.fill) this.fill.style.transform = `scaleX(${this.progress.toFixed(4)})`;
    }
    const index = Math.min(this.items, Math.round(this.progress * (this.items - 1)) + 1);
    if (index !== this.lastIndex && this.count) {
      this.lastIndex = index;
      this.count.textContent = `${String(index).padStart(2, "0")} / ${String(this.items).padStart(2, "0")}`;
    }
  }
}
