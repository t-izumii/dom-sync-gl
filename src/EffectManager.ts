import * as THREE from 'three';
import type GUI from 'lil-gui';
import { EffectComposer } from './EffectComposer';
import type { EffectLike } from './EffectComposer';
import type { BaseEffect } from './effects/BaseEffect';

export class EffectManager {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly gui: GUI | null;
  // scene 描画 RenderTarget の MSAA サンプル数。既定値の解決は Core が行い、
  // 直接生成した場合は 0（MSAA 無効）。
  private readonly effectSamples: number;

  private effects: BaseEffect[] = [];
  private postEffect: EffectLike | null = null;
  // postEffect を EffectManager が所有するか。所有する場合のみ置き換え・
  // clearEffects()・dispose() で dispose する（{ owned: false } で opt-out）。
  private postEffectOwned = true;
  private internalComposer: EffectComposer | null = null;
  // 直近の viewport サイズ。setPostEffect 直後に現在サイズで resize するために保持。
  private lastWidth: number | undefined;
  private lastHeight: number | undefined;

  constructor(opts: {
    renderer: THREE.WebGLRenderer;
    gui: GUI | null;
    effectSamples?: number;
  }) {
    this.renderer = opts.renderer;
    this.gui = opts.gui;
    this.effectSamples = opts.effectSamples ?? 0;
  }

  hasEffects(): boolean {
    return this.effects.length > 0;
  }
  addEffect<T extends BaseEffect>(effect: T, width: number, height: number): T {
    if (this.postEffect && this.postEffect !== this.internalComposer) {
      const msg =
        '[DomSyncGL] addEffect() を呼ぶ前に setPostEffect() でカスタム postEffect が設定されています。' +
        '内部 EffectComposer で上書きします。カスタム postEffect は手動で dispose してください。';

      // DEV: 誤用に開発中すぐ気付けるよう即 throw（fail-fast）。
      // production: アプリを落とさず warn ログのみに留め、後続のフォールバック処理
      // （内部 EffectComposer で上書き）を続行する。
      if (import.meta.env?.DEV) throw new Error(msg);
      console.warn(msg);
    }
    if (!this.internalComposer) {
      this.internalComposer = new EffectComposer(
        this.renderer,
        width,
        height,
        this.effectSamples,
      );
      this.postEffect = this.internalComposer;
      this.postEffectOwned = true;
    }
    this.lastWidth = width;
    this.lastHeight = height;

    effect._setRenderer?.(this.renderer);
    effect._register(this.internalComposer);
    effect.resize?.(width, height);

    if (this.gui && effect.setupGUI) {
      const folder = effect.setupGUI(this.gui);
      if (folder) effect._attachGUI(folder);
    }
    this.effects.push(effect);
    return effect;
  }

  /**
   * ポストエフェクトパイプラインをカスタム実装に差し替える。
   *
   * 所有権契約: EffectManager は設定された postEffect を所有し、置き換え
   * （再呼び出し）・clearEffects()・dispose() の際に前の postEffect を dispose
   * する。呼び出し側で dispose を管理したい場合は `{ owned: false }` を渡すと、
   * EffectManager からは一切 dispose しない。
   *
   * width/height を渡すと（省略時は直近の viewport サイズがあればそれで）設定
   * 直後に resize し、次のリサイズを待たずに現在サイズを反映する。
   */
  setPostEffect(
    postEffect: EffectLike,
    width?: number,
    height?: number,
    options?: { owned?: boolean },
  ): void {
    if (this.effects.length > 0) {
      const msg =
        '[DomSyncGL] setPostEffect() が呼ばれましたが、addEffect() で追加した effect が既に存在します。' +
        '内部 EffectComposer を破棄してカスタム postEffect に差し替えます。' +
        '事前に clearEffects() を呼ぶことを推奨します。';
      // DEV: fail-fast で即 throw。production: warn のみでフォールバック
      // （clearEffects() して差し替え）を続行する。上の addEffect() と同じ方針。
      if (import.meta.env?.DEV) throw new Error(msg);
      console.warn(msg);

      this.clearEffects();
    }
    // 置き換え時に前の postEffect を取りこぼさない（所有している場合のみ。
    // 同一インスタンスの再設定では dispose すると使用中のまま壊れるため除外）。
    if (this.postEffect && this.postEffectOwned && this.postEffect !== postEffect) {
      this.postEffect.dispose();
    }
    this.postEffect = postEffect;
    this.postEffectOwned = options?.owned ?? true;

    const w = width ?? this.lastWidth;
    const h = height ?? this.lastHeight;
    if (w !== undefined && h !== undefined) {
      this.lastWidth = w;
      this.lastHeight = h;
      postEffect.resize(w, h);
    }
  }

  removeEffect(effect: BaseEffect): boolean {
    const idx = this.effects.indexOf(effect);
    if (idx < 0) return false;
    this.effects.splice(idx, 1);
    const pass = effect.getPass();
    if (pass && this.internalComposer) {
      this.internalComposer.removeEffect(pass);
    }
    effect._dispose();
    // 最後の effect が外れたら internalComposer（RenderTarget を抱える）を解放する。
    // 次の addEffect で再生成される。
    if (this.effects.length === 0 && this.internalComposer) {
      this.internalComposer.dispose();
      if (this.postEffect === this.internalComposer) {
        this.postEffect = null;
        this.postEffectOwned = true;
      }
      this.internalComposer = null;
    }
    return true;
  }

  clearEffects(): void {
    for (const effect of this.effects) {
      effect._dispose();
    }
    this.effects = [];
    if (this.postEffectOwned) this.postEffect?.dispose();
    this.postEffect = null;
    this.postEffectOwned = true;
    this.internalComposer = null;
  }

  update(elapsed: number, mouse: THREE.Vector2): void {
    const effects = this.effects;
    for (let i = 0, n = effects.length; i < n; i++) {
      const effect = effects[i];
      if (!effect.enabled) continue;
      effect.update(elapsed, mouse);
    }
  }

  render(
    scene: THREE.Scene,
    camera: THREE.Camera,
    outputTarget: THREE.WebGLRenderTarget | null,
  ): void {
    if (this.postEffect) {
      this.postEffect.render(scene, camera, outputTarget);
    } else {
      // postEffect 無しの素通しでも、外部がバインドした RenderTarget を壊さない
      // よう保存・復元し、最終出力は outputTarget にのみ書く。
      const prevTarget = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(outputTarget);
      this.renderer.render(scene, camera);
      this.renderer.setRenderTarget(prevTarget);
    }
  }

  resize(width: number, height: number): void {
    this.lastWidth = width;
    this.lastHeight = height;
    this.postEffect?.resize(width, height);
    const effects = this.effects;
    for (let i = 0, n = effects.length; i < n; i++) {
      effects[i].resize?.(width, height);
    }
  }

  dispose(): void {
    for (const effect of this.effects) {
      effect._dispose();
    }
    this.effects = [];
    if (this.postEffectOwned) this.postEffect?.dispose();
    this.postEffect = null;
    this.postEffectOwned = true;
    this.internalComposer = null;
  }
}
