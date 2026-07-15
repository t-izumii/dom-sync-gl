import type Stats from 'stats.js';
import type GUI from 'lil-gui';

/**
 * stats.js / lil-gui のインスタンスは呼び出し元が生成して渡す。
 * このクラスは毎フレームの begin()/end() 呼び出しと GUI の受け渡しのみを担い、
 * インスタンスの生成・DOM 挿入・破棄は一切行わない（呼び出し元の所有物のため）。
 */
export class DevTools {
  private readonly stats: Stats | null;
  private readonly gui: GUI | null;

  constructor(opts: { stats?: Stats | null; gui?: GUI | null }) {
    this.stats = opts.stats ?? null;
    this.gui = opts.gui ?? null;
  }

  beginStats(): void {
    this.stats?.begin();
  }

  endStats(): void {
    this.stats?.end();
  }

  getGUI(): GUI | null {
    return this.gui;
  }
}
