import * as THREE from 'three';
import type GUI from 'lil-gui';
import { EffectComposer } from './EffectComposer';
import type { EffectLike } from './EffectComposer';
import type { BaseEffect } from './effects/BaseEffect';

export class EffectManager {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly gui: GUI | null;

  private effects: BaseEffect[] = [];
  private postEffect: EffectLike | null = null;
  private internalComposer: EffectComposer | null = null;

  constructor(opts: {
    renderer: THREE.WebGLRenderer;
    gui: GUI | null;
  }) {
    this.renderer = opts.renderer;
    this.gui = opts.gui;
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
      this.internalComposer = new EffectComposer(this.renderer, width, height);
      this.postEffect = this.internalComposer;
    }

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

  setPostEffect(postEffect: EffectLike): void {
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
    this.postEffect = postEffect;
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
    return true;
  }

  clearEffects(): void {
    for (const effect of this.effects) {
      effect._dispose();
    }
    this.effects = [];
    this.postEffect?.dispose();
    this.postEffect = null;
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
    this.postEffect?.dispose();
    this.postEffect = null;
    this.internalComposer = null;
  }
}
