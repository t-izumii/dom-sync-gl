import type { IUniform, Vector2, WebGLRenderer } from "three";
import type GUI from "lil-gui";
import type { EffectTarget, EffectPass } from "../EffectComposer";

export interface BaseEffectConfig {
  fragmentShader: string;
  uniforms?: { [key: string]: IUniform };
}

/**
 * ポストエフェクトの基底クラス。
 *
 * effect インスタンスは単一 owner・使い捨てで、`new → registered → disposed` の
 * 一方向ライフサイクルを取る:
 * - `new`: 生成直後。まだどの owner にも属さない。
 * - `registered`: `EffectManager.addEffect()` または `DomPlane.addEffect()` で
 *   1 つの owner に登録済み。別の owner への再登録は throw する。
 * - `disposed`: owner の `removeEffect()` / `dispose()` で破棄済み。以後の再登録は
 *   throw する。使い回す場合は新しいインスタンスを生成すること。
 */
export abstract class BaseEffect {
  protected pass: EffectPass | null = null;
  private _guiFolder: GUI | null = null;
  private _disposed = false;

  private _enabled = true;
  get enabled(): boolean {
    return this._enabled;
  }
  set enabled(value: boolean) {
    this._enabled = value;
    if (this.pass) this.pass.enabled = value;
  }

  protected abstract getConfig(): BaseEffectConfig;

  _register(target: EffectTarget): void {
    // effect は単一 owner・使い捨て。二重 register を許すと owner をまたいで
    // update が二重実行される・一方の owner が他方で使用中の effect を dispose
    // できる、といった registry の破壊が起きるため throw する。
    if (this._disposed) {
      throw new Error(
        "[BaseEffect] dispose 済みの effect は再登録できません。" +
          "使い回す場合は新しいインスタンスを作ってください。",
      );
    }
    if (this.pass !== null) {
      throw new Error(
        "[BaseEffect] この effect インスタンスは既に別の owner に登録済みです。" +
          "1 つの effect インスタンスは 1 つの owner にしか追加できません。" +
          "`webgl.addEffect()` と `domPlane.addEffect()` を併用する場合など、" +
          "使い回す場合は新しいインスタンスを作ってください。",
      );
    }
    const config = this.getConfig();
    this.pass = target.addEffect({
      fragmentShader: config.fragmentShader,
      uniforms: config.uniforms,
    });
    this.pass.enabled = this._enabled;
  }

  _setRenderer?(_renderer: WebGLRenderer): void;

  update(_time: number, _mouse?: Vector2): void {}

  resize?(_width: number, _height: number): void;

  setupGUI?(gui: GUI): GUI | void;

  /**
   * setupGUI() が返したフォルダを登録する。呼び出し元は保持しない（`_dispose()` が破棄する）。
   * 既に _dispose() 済みなら（FeedbackBuffer._attachGUI() と同様）即座に破棄する。
   */
  _attachGUI(folder: GUI): void {
    if (this._disposed) {
      folder.destroy();
      return;
    }
    this._guiFolder = folder;
  }

  dispose?(): void;

  /**
   * `EffectManager` / `DomPlane` からの唯一の破棄経路。
   * setupGUI() で作られた GUI フォルダを破棄した上で、サブクラスの dispose() を呼ぶ。
   */
  _dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._guiFolder?.destroy();
    this._guiFolder = null;
    this.dispose?.();
  }

  setUniform(key: string, value: unknown): void {
    this.pass?.setUniform(key, value);
  }

  getUniform(key: string): IUniform | undefined {
    return this.pass?.getUniform(key);
  }

  getPass(): EffectPass | null {
    return this.pass;
  }
}
