/**
 * ローダーとイントロの進行管理。
 *
 *   loading    : 百分率カウンタが進む。素材（フォント・GL の初期化・板の構築）が
 *                揃うまでは 72% 手前で粘り、揃ったら 100 まで進む
 *   transition : 仕上げパスの uIntro を 0→1。途中で onReveal（本文の出現・見出しの
 *                せり上がり）を一度だけ呼ぶ
 *   done       : ローダーを外して onDone
 *
 * 数値の進行は main.ts のループから update(dt) で進める（独自の rAF を持たない）。
 * GL が使えない場合は setIntro を持たないまま、DOM のフェードだけで終える。
 */
import { easeInOutCubic } from "../env";

export interface IntroTarget {
  setLoad(v: number): void;
  setIntro(v: number): void;
}

type Phase = "loading" | "transition" | "done";

export class Intro {
  private phase: Phase = "loading";
  private shown = 0;
  private lastShown = -1;
  private assetsReady = false;
  private t = 0;
  private revealed = false;
  private target: IntroTarget | null = null;
  private readonly countEl: HTMLElement | null;

  constructor(
    private readonly root: HTMLElement,
    private readonly opts: {
      reduced: () => boolean;
      onReveal: () => void;
      onDone: () => void;
    },
  ) {
    this.countEl = root.querySelector(".js-loader-count");
  }

  /** GL の仕上げパスを繋ぐ。ここから先はローダーの黒と光漏れを GL が描く */
  attach(target: IntroTarget): void {
    this.target = target;
    target.setLoad(this.shown / 100);
    target.setIntro(0);
  }

  /** 1 フレーム描いた後に呼ぶ。DOM の黒をやめて GL を透かす */
  handOver(): void {
    this.root.classList.add("is-gl");
  }

  setAssetsReady(): void {
    this.assetsReady = true;
  }

  get isDone(): boolean {
    return this.phase === "done";
  }

  update(dt: number): void {
    if (this.phase === "loading") {
      const reduced = this.opts.reduced();
      const goal = this.assetsReady ? 100 : 72;
      // 目標へ指数的に近づけつつ、最低速度を持たせて止まって見えないようにする
      const speed = reduced ? 400 : this.assetsReady ? 90 : 38;
      this.shown = Math.min(goal, this.shown + Math.max((goal - this.shown) * 2.2 * dt, speed * 0.12 * dt));
      const n = Math.floor(this.shown);
      if (n !== this.lastShown && this.countEl) {
        this.lastShown = n;
        this.countEl.textContent = String(n).padStart(3, "0");
      }
      this.target?.setLoad(this.shown / 100);
      if (this.assetsReady && this.shown >= 99.9) {
        this.phase = "transition";
        this.root.classList.add("is-leaving");
      }
      return;
    }

    if (this.phase === "transition") {
      // 動きの抑制中は光のバーストを見せず、短いフェードで切り替える
      const duration = this.opts.reduced() || !this.target ? 0.5 : 2.4;
      this.t = Math.min(1, this.t + dt / duration);
      this.target?.setIntro(easeInOutCubic(this.t));
      // DOM のカウンタは遷移の頭で消す（GL の境界が広がる裏で本文が出始める）
      if (this.t > 0.02) this.root.classList.add("is-done");
      if (!this.revealed && this.t > 0.32) {
        this.revealed = true;
        this.opts.onReveal();
      }
      if (this.t >= 1) {
        this.phase = "done";
        if (!this.revealed) {
          this.revealed = true;
          this.opts.onReveal();
        }
        this.opts.onDone();
      }
    }
  }
}
