import * as THREE from 'three';
import type GUI from 'lil-gui';
import { EffectComposer } from './EffectComposer';
import type { EffectLike } from './EffectComposer';
import type { BaseEffect, EffectOutput } from './effects/BaseEffect';
import { FeedbackBuffer } from './FeedbackBuffer';

/**
 * フルスクリーンのポストエフェクト群を集約管理する。
 *
 * - `addEffect()`: 内部 EffectComposer を lazy 生成して ping-pong チェーンに繋ぐ。
 * - `setPostEffect()`: 低レベル。EffectLike を丸ごと差し替える。
 * - `update()` / `render()` / `resize()`: DomSyncGL の rAF / resize から呼ばれる。
 *
 * GUI 連携（setupGUI）は DomSyncGL（= DevTools）から渡される `ensureGUI` 経由で行う。
 */
export class EffectManager {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly showGUI: boolean;
  private readonly ensureGUI: () => Promise<GUI>;
  /** addEffect の setupGUI 配線後、app が destroy 済みかを確認するためのフラグ参照。 */
  private readonly isDestroyed: () => boolean;

  private effects: BaseEffect[] = [];
  private postEffect: EffectLike | null = null;
  private internalComposer: EffectComposer | null = null;
  /**
   * fullscreen post に generate（テクスチャ生成パス）を持つ effect の generator 群。
   * 毎フレ step してグローバルマウスで軌跡等を蓄積し、合成 pass の uGenerated に供給する。
   */
  private generators: {
    buffer: FeedbackBuffer;
    sink: (tex: THREE.Texture) => void;
    owner: BaseEffect;
  }[] = [];
  /** generator の uAspect 計算に使う現在の描画サイズ。addEffect / resize で更新。 */
  private _width = 1;
  private _height = 1;
  /** generator step の mouse を破壊せず渡すスクラッチ。 */
  private readonly _genMouse = new THREE.Vector2(0.5, 0.5);

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

  /** 現在 addEffect で積まれた effect があるか（setPostEffect の競合警告に使う）。 */
  hasEffects(): boolean {
    return this.effects.length > 0;
  }

  /**
   * canvas 全体にエフェクトを追加する。内部で EffectComposer を自動生成する。
   *
   * **注意**: `setPostEffect()` でカスタム postEffect を入れている状態で呼ぶと、
   * 自動生成された EffectComposer で上書きされる（カスタム postEffect の dispose は
   * 呼ばれない＝呼び出し側の責務）。両 API の併用は避けること。
   */
  addEffect<T extends BaseEffect>(
    effect: T,
    width: number,
    height: number,
    options?: { output?: EffectOutput },
  ): T {
    const output: EffectOutput = options?.output ?? 'post';
    if (output !== 'post') {
      // app 全体には供給先 material が無いので texture 出力は不可（plane.addEffect を使う）。
      throw new Error(
        "[DomSyncGL] app.addEffect は output:'post'（fullscreen 合成）専用です。" +
          ' texture 出力は plane.addEffect(effect, { output: { uniform } }) を使ってください。',
      );
    }
    if (this.postEffect && this.postEffect !== this.internalComposer) {
      const msg =
        '[DomSyncGL] addEffect() を呼ぶ前に setPostEffect() でカスタム postEffect が設定されています。' +
        '内部 EffectComposer で上書きします。カスタム postEffect は手動で dispose してください。';
      // DEV では事故防止のため throw（カスタム effect の dispose リークになるため）。
      if (import.meta.env?.DEV) throw new Error(msg);
      console.warn(msg);
    }
    if (!this.internalComposer) {
      this.internalComposer = new EffectComposer(this.renderer, width, height);
      this.postEffect = this.internalComposer;
    }
    this._width = width;
    this._height = height;
    // renderer を要求するエフェクト（FluidEffect 等）に注入してから register する
    effect._setRenderer?.(this.renderer);

    const config = effect._getConfig();
    if (config.generate) {
      // generate を持つ effect: グローバルな軌跡テクスチャを作り、合成 pass の uGenerated に流す。
      if (!config.fragmentShader) {
        throw new Error(
          "[DomSyncGL] app.addEffect で generate を使うには合成用 fragmentShader が必要です。",
        );
      }
      const buffer = new FeedbackBuffer(this.renderer, {
        fragmentShader: config.generate.fragmentShader,
        vertexShader: config.generate.vertexShader,
        size: config.generate.size,
        uniforms: config.generate.uniforms,
      });
      const pass = this.internalComposer.addEffect({
        fragmentShader: config.fragmentShader,
        uniforms: { uGenerated: { value: buffer.texture }, ...config.uniforms },
      });
      effect._setPass(pass);
      this.generators.push({
        buffer,
        sink: (tex) => pass.setUniform('uGenerated', tex),
        owner: effect,
      });
    } else {
      // generator なしの素の fullscreen post（従来どおり）
      effect._register(this.internalComposer);
    }
    effect.resize?.(width, height);
    // setupGUI を実装している場合は自動で lil-gui パネルを生やす。
    // lil-gui は optional peer なので dynamic import の resolve を await してから呼ぶ。
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

  /**
   * ポストエフェクトを設定（低レベル API）。
   *
   * **注意**: `addEffect()` で追加済みの effect がある状態で呼ぶと、自動 EffectComposer を
   * 捨てて引数の postEffect に差し替える（既存 effect は dispose される）。
   */
  setPostEffect(postEffect: EffectLike): void {
    if (this.effects.length > 0) {
      const msg =
        '[DomSyncGL] setPostEffect() が呼ばれましたが、addEffect() で追加した effect が既に存在します。' +
        '内部 EffectComposer を破棄してカスタム postEffect に差し替えます。' +
        '事前に clearEffects() を呼ぶことを推奨します。';
      if (import.meta.env?.DEV) throw new Error(msg);
      console.warn(msg);
      // 既存 effect の clean up（dispose まで）
      this.clearEffects();
    }
    this.postEffect = postEffect;
  }

  /**
   * `addEffect()` で登録した effect を 1 つ取り除く。登録されていなければ false。
   * 内部 EffectComposer は残す（次の addEffect で再利用）。
   */
  removeEffect(effect: BaseEffect): boolean {
    const idx = this.effects.indexOf(effect);
    if (idx < 0) return false;
    this.effects.splice(idx, 1);
    const pass = effect.getPass();
    if (pass && this.internalComposer) {
      this.internalComposer.removeEffect(pass);
    }
    // この effect の generator（FeedbackBuffer）も外して dispose する。
    for (let i = this.generators.length - 1; i >= 0; i--) {
      if (this.generators[i].owner === effect) {
        this.generators[i].buffer.dispose();
        this.generators.splice(i, 1);
      }
    }
    effect.dispose?.();
    return true;
  }

  /** generator(FeedbackBuffer) をすべて dispose する。 */
  private disposeGenerators(): void {
    for (const g of this.generators) g.buffer.dispose();
    this.generators = [];
  }

  /** 登録された effect / postEffect をすべて解除して破棄する。 */
  clearEffects(): void {
    for (const effect of this.effects) {
      effect.dispose?.();
    }
    this.effects = [];
    this.disposeGenerators();
    this.postEffect?.dispose();
    this.postEffect = null;
    this.internalComposer = null;
  }

  /** rAF tick 内: generator を 1 歩進め、有効な effect の update を回す。 */
  update(elapsed: number, mouse: THREE.Vector2): void {
    // generator（fullscreen post の軌跡等）を main render より前に step し uGenerated を更新。
    // app 全体なので mouse は canvas グローバル UV、hover は常時 1。
    if (this.generators.length > 0) {
      this._genMouse.copy(mouse);
      const aspect = this._height > 0 ? this._width / this._height : 1;
      for (let i = 0, n = this.generators.length; i < n; i++) {
        const g = this.generators[i];
        if (!g.owner.enabled) continue;
        const tex = g.buffer.step({
          mouse: this._genMouse,
          hover: 1,
          time: elapsed,
          aspect,
        });
        g.sink(tex);
      }
    }
    const effects = this.effects;
    for (let i = 0, n = effects.length; i < n; i++) {
      const effect = effects[i];
      if (!effect.enabled) continue;
      effect.update(elapsed, mouse);
    }
  }

  /**
   * 本体レンダリング。postEffect があればそれ経由（シーン→FBO→エフェクト→canvas）、
   * 無ければ通常 render。
   */
  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.postEffect) {
      this.postEffect.render(scene, camera);
    } else {
      this.renderer.render(scene, camera);
    }
  }

  resize(width: number, height: number): void {
    this._width = width;
    this._height = height;
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
    this.disposeGenerators();
    this.postEffect?.dispose();
    this.postEffect = null;
    this.internalComposer = null;
  }
}
