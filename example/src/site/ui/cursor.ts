/**
 * カスタムカーソル。点は即座に、輪は少し遅れて追う。
 * `data-cursor="Look"` を持つ要素の上では輪が広がってラベルを出し、
 * リンク・ボタンの上では輪だけ広げる。
 *
 * 独自の rAF は持たず、main.ts の 1 本のループから update(dt) を呼ぶ。
 * リスナーは渡された AbortSignal でまとめて外す。
 */
import { damp } from "../env";

export class Cursor {
  private readonly dot: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly label: HTMLElement;
  private x = window.innerWidth / 2;
  private y = window.innerHeight / 2;
  private rx = this.x;
  private ry = this.y;
  private visible = false;

  constructor(
    private readonly root: HTMLElement,
    signal: AbortSignal,
  ) {
    this.dot = root.querySelector<HTMLElement>(".cursor__dot")!;
    this.ring = root.querySelector<HTMLElement>(".cursor__ring")!;
    this.label = root.querySelector<HTMLElement>(".cursor__label")!;
    document.body.classList.add("custom-cursor");
    root.style.opacity = "0";

    window.addEventListener(
      "pointermove",
      (e) => {
        if (e.pointerType !== "mouse") return;
        this.x = e.clientX;
        this.y = e.clientY;
        if (!this.visible) {
          // 初回は輪を瞬間移動させ、画面中央から飛んでくるのを防ぐ
          this.visible = true;
          this.rx = this.x;
          this.ry = this.y;
          root.style.opacity = "1";
        }
      },
      { passive: true, signal },
    );
    document.addEventListener(
      "pointerleave",
      () => {
        this.visible = false;
        root.style.opacity = "0";
      },
      { signal },
    );
    // 委譲で状態を切り替える（要素ごとにリスナーを張らない）
    document.addEventListener("pointerover", (e) => this.onOver(e.target), { signal });
  }

  private onOver(target: EventTarget | null): void {
    const el = target instanceof Element ? target : null;
    const labelled = el?.closest<HTMLElement>("[data-cursor]");
    const link = el?.closest("a, button");
    this.root.classList.toggle("is-label", !!labelled);
    this.root.classList.toggle("is-link", !labelled && !!link);
    const text = labelled?.dataset.cursor ?? "";
    if (this.label.textContent !== text) this.label.textContent = text;
  }

  update(dt: number): void {
    if (!this.visible) return;
    this.rx = damp(this.rx, this.x, 14, dt);
    this.ry = damp(this.ry, this.y, 14, dt);
    this.dot.style.transform = `translate3d(${this.x}px, ${this.y}px, 0)`;
    this.ring.style.transform = `translate3d(${this.rx}px, ${this.ry}px, 0)`;
  }

  destroy(): void {
    document.body.classList.remove("custom-cursor");
  }
}
