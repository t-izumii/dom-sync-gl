/**
 * マニフェストの語ごとの点灯。段落を語単位の span に分け、スクロール進捗を
 * CSS 変数 --p（点灯済みの語数）として段落に書き込む。各語は自分の --i と比べて
 * 不透明度と滲み（text-shadow）を CSS 側で決めるので、毎フレーム触る DOM は 1 つだけ。
 *
 * 進捗 progress（0..1）は GL のフレア（flare.ts）の位置にも使う。
 */
import { clamp01 } from "../env";

export class Manifesto {
  private readonly count: number;
  private top = 0;
  private height = 1;
  private lastP = -1;
  /** 0..1。段落を読み進めた割合 */
  progress = 0;

  constructor(private readonly el: HTMLElement) {
    // 空白で区切った語を span にする（空白はテキストノードのまま残す）
    const words = (el.textContent ?? "").trim().split(/\s+/);
    el.textContent = "";
    words.forEach((word, i) => {
      const span = document.createElement("span");
      span.className = "w";
      span.style.setProperty("--i", String(i));
      span.textContent = word;
      el.append(span);
      if (i < words.length - 1) el.append(" ");
    });
    this.count = words.length;
    this.measure();
  }

  measure(): void {
    const r = this.el.getBoundingClientRect();
    this.top = r.top + window.scrollY;
    this.height = Math.max(1, r.height);
  }

  /**
   * @param still 動きの抑制中は全語を点灯した静的な状態にする
   */
  update(scrollY: number, vh: number, still: boolean): void {
    // 段落の上端が画面の 85% に来た時に始まり、下端が 45% に来た時に読み終わる
    const start = this.top - vh * 0.85;
    const end = this.top + this.height - vh * 0.45;
    this.progress = still ? 1 : clamp01((scrollY - start) / Math.max(1, end - start));
    // 最後の語の滲みが消えきるまで少し余らせる
    const p = still ? this.count + 2 : this.progress * (this.count + 1.6);
    if (Math.abs(p - this.lastP) > 0.01) {
      this.lastP = p;
      this.el.style.setProperty("--p", p.toFixed(3));
    }
  }
}
