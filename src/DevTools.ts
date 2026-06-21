import type Stats from 'stats.js';
import type GUI from 'lil-gui';

export class DevTools {
  private readonly showStats: boolean;
  private readonly statsParent: HTMLElement;
  private readonly showGUI: boolean;
  private readonly guiTitle: string;
  private readonly isDestroyed: () => boolean;

  private stats: Stats | null = null;
  private gui: GUI | null = null;
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

  loadStats(): void {
    if (!this.showStats) return;
    void import('stats.js')
      .then(({ default: StatsCtor }) => {
        if (this.isDestroyed()) return;
        this.stats = new StatsCtor();
        this.stats.showPanel(0);
        this.statsParent.appendChild(this.stats.dom);
      })
      .catch((err) => {
        console.warn(
          '[DomSyncGL] showStats: true ですが stats.js が読み込めませんでした。' +
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

  getGUI(): GUI | null {
    if (!this.showGUI) return null;
    return this.gui;
  }

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
