import Lenis from 'lenis';
import type { LenisOptions } from 'lenis';

/**
 * RafScroll の公開オプション。スムーズスクロールの実体は Lenis に委譲しているため、
 * Lenis のオプション（lerp / duration / easing / smoothWheel / wheelMultiplier /
 * touchMultiplier / syncTouch など）をそのまま受け付ける。
 *
 * 例外は `autoRaf`。RafScroll は「所有者（Core）の単一 rAF ループから advance() で
 * 駆動する管理モード」を持つため、その制御は `autoStart` 経由で行う（下記参照）。
 */
export interface RafScrollOptions extends Omit<LenisOptions, 'autoRaf'> {
  /**
   * true なら内部で rAF ループを自走させる（スタンドアロン利用）。
   * false なら自走せず、所有者が毎フレーム advance() を呼んで駆動する（Core 管理下の挙動）。
   * @default true
   */
  autoStart?: boolean;
}

/**
 * Lenis を内部に持つ薄いラッパー。従来の自前実装（wheel/touch 蓄積 + 慣性 + window.scrollTo）を
 * Lenis に置き換えたもの。公開 API（scrollY / enabled / advance / destroy）は据え置きなので
 * Core 側の配線は変更不要。Lenis は window をラッパーとして実 scroll を更新するため、
 * Core が advance() 後に読む window.scrollY もそのまま整合する。
 */
export class RafScroll {
  private _lenis: Lenis;
  private _autoStart: boolean;
  private _destroyed: boolean = false;

  constructor(options: RafScrollOptions = {}) {
    const { autoStart = true, ...lenisOptions } = options;
    this._autoStart = autoStart;

    // autoStart=false（Core 管理モード）では Lenis の自走 rAF を止め、advance() で駆動する。
    this._lenis = new Lenis({ ...lenisOptions, autoRaf: autoStart });
  }

  /**
   * 所有者の rAF ループから毎フレーム呼ぶ。自走モード（autoStart:true）では Lenis 内部の
   * rAF が回っているため no-op。
   * @param now performance.now() 由来の ms タイムスタンプ
   */
  advance(now: number = performance.now()): void {
    if (this._destroyed) return;
    if (this._autoStart) return;
    this._lenis.raf(now);
  }

  /** 現在の（スムージング後の）スクロール量。 */
  get scrollY(): number {
    return this._lenis.scroll;
  }

  /** 内部 Lenis インスタンス（scrollTo / on('scroll') など高度な操作用）。 */
  get lenis(): Lenis {
    return this._lenis;
  }

  set enabled(value: boolean) {
    if (this._destroyed) return;
    if (value) this._lenis.start();
    else this._lenis.stop();
  }

  get enabled(): boolean {
    return !this._lenis.isStopped;
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._lenis.destroy();
  }
}
