import * as THREE from 'three';
import type GUI from 'lil-gui';
import { EffectComposer } from './EffectComposer';
import type { EffectLike } from './EffectComposer';
import type { BaseEffect } from './effects/BaseEffect';

export class EffectManager {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly showGUI: boolean;
  private readonly ensureGUI: () => Promise<GUI>;
  private readonly isDestroyed: () => boolean;

  private effects: BaseEffect[] = [];
  private postEffect: EffectLike | null = null;
  private internalComposer: EffectComposer | null = null;

  constructor(opts: {
    renderer: THREE.WebGLRenderer;
    showGUI: boolean;
    ensureGUI: () => Promise<GUI>;
    isDestroyed: () => boolean;
  }) {
    this.renderer = opts.renderer;
    this.showGUI = opts.showGUI;
    this.ensureGUI = opts.ensureGUI;
    this.isDestroyed = opts.isDestroyed;
  }

  hasEffects(): boolean {
    return this.effects.length > 0;
  }
  addEffect<T extends BaseEffect>(effect: T, width: number, height: number): T {
    if (this.postEffect && this.postEffect !== this.internalComposer) {
      const msg =
        '[DomSyncGL] addEffect() を呼ぶ前に setPostEffect() でカスタム postEffect が設定されています。' +
        '内部 EffectComposer で上書きします。カスタム postEffect は手動で dispose してください。';

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

    if (this.showGUI && effect.setupGUI) {
      this.ensureGUI()
        .then((gui) => {
          if (this.isDestroyed()) return;
          effect.setupGUI!(gui);
        })
        .catch((err) => {
          console.warn(
            '[DomSyncGL] showGUI: true ですが lil-gui が読み込めませんでした。' +
              'npm install lil-gui してください。',
            err,
          );
        });
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
    effect.dispose?.();
    return true;
  }

  clearEffects(): void {
    for (const effect of this.effects) {
      effect.dispose?.();
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

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.postEffect) {
      this.postEffect.render(scene, camera);
    } else {
      this.renderer.render(scene, camera);
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
      effect.dispose?.();
    }
    this.effects = [];
    this.postEffect?.dispose();
    this.postEffect = null;
    this.internalComposer = null;
  }
}
