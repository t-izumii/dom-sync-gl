import type Stats from 'stats.js';
import type GUI from 'lil-gui';

/**
 * 開発支援パネル（stats.js の FPS パネル / lil-gui）の lazy dynamic import を担う。
 *
 * `stats.js` / `lil-gui` はどちらも optional peer dependency。`showStats` / `showGUI` が
 * 有効なときだけ動的 import するので、使わない利用者はインストール不要。
 */
export class DevTools {
  private readonly showStats: boolean;
  private readonly statsParent: HTMLElement;
  private readonly showGUI: boolean;
  private readonly guiTitle: string;
  /** WebGLApp が destroy 済みかを確認するための参照（import 解決後の guard 用）。 */
  private readonly isDestroyed: () => boolean;

  private stats: Stats | null = null;
  private gui: GUI | null = null;
  /** lil-gui の dynamic import promise。複数 effect から同時に呼ばれても 1 インスタンスに揃える。 */
  private guiLoadPromise: Promise<GUI> | null = null;

  constructor(opts: {
    showStats: boolean;
    statsParent: HTMLElement;
    showGUI: boolean;
    guiTitle: string;
    isDestroyed: () => boolean;
  }) {
    this.showStats = opts.showStats;
    this.statsParent = opts.statsParent;
    this.showGUI = opts.showGUI;
    this.guiTitle = opts.guiTitle;
    this.isDestroyed = opts.isDestroyed;
  }

  /**
   * 構築直後に呼ぶ。`showStats: true` のとき stats.js を dynamic import して panel を出す。
   * import 完了前に destroy された場合は何もしない。
   */
  loadStats(): void {
    if (!this.showStats) return;
    void import('stats.js')
      .then(({ default: StatsCtor }) => {
        if (this.isDestroyed()) return;
        this.stats = new StatsCtor();
        this.stats.showPanel(0); // 0: fps, 1: ms, 2: mb
        this.statsParent.appendChild(this.stats.dom);
      })
      .catch((err) => {
        console.warn(
          '[WebGLApp] showStats: true ですが stats.js が読み込めませんでした。' +
            'npm install stats.js してください。',
          err,
        );
      });
  }

  beginStats(): void {
    this.stats?.begin();
  }

  endStats(): void {
    this.stats?.end();
  }

  /**
   * lil-gui を dynamic import で読み込み、root インスタンスを lazy 生成して返す。
   * 同時に複数から呼ばれても load promise を共有して 1 インスタンスにまとめる。
   */
  ensureGUI(): Promise<GUI> {
    if (this.gui) return Promise.resolve(this.gui);
    if (!this.guiLoadPromise) {
      this.guiLoadPromise = import('lil-gui').then(({ default: GuiCtor }) => {
        if (!this.gui) {
          this.gui = new GuiCtor({ title: this.guiTitle });
        }
        return this.gui;
      });
    }
    return this.guiLoadPromise;
  }

  /**
   * root の lil-gui インスタンスを取得 (sync)。load 中は null。`showGUI: false` なら常に null。
   */
  getGUI(): GUI | null {
    if (!this.showGUI) return null;
    return this.gui;
  }

  /** lil-gui を必要に応じて load して返す。`showGUI: false` なら null を resolve。 */
  getGUIAsync(): Promise<GUI | null> {
    if (!this.showGUI) return Promise.resolve(null);
    return this.ensureGUI();
  }

  dispose(): void {
    if (this.stats) {
      this.stats.dom.remove();
      this.stats = null;
    }
    if (this.gui) {
      this.gui.destroy();
      this.gui = null;
    }
  }
}
