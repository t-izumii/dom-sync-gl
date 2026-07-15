import type { IUniform, Vector2, WebGLRenderer } from "three";
import type GUI from "lil-gui";
import type { EffectTarget, EffectPass } from "../EffectComposer";

export interface BaseEffectConfig {
  fragmentShader: string;
  uniforms?: { [key: string]: IUniform };
}

export abstract class BaseEffect {
  protected pass: EffectPass | null = null;
  private target: EffectTarget | null = null;
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
    // getConfig() はサブクラス実装で例外を投げうる。先に呼んでおくことで、
    // 例外時に旧 pass/target を破棄済みの不整合な状態にしないようにする。
    const config = this.getConfig();

    // 二重 register は致命的ではない（下で旧 pass を古い target から dispose した上で
    // 新しい pass に差し替えるため動作は継続する）ため throw はしない。DEV でのみ
    // 警告を出し、production のコンソールを汚さない。
    if (this.pass !== null) {
      if (import.meta.env?.DEV) {
        console.warn(
          "[BaseEffect] 同じ effect インスタンスを複数の target に register しています。" +
          "`webgl.addEffect()` と `domPlane.addEffect()` を併用する場合は別インスタンスを作ってください。"
        );
      }
      // 古い pass を古い target から確実に取り除いて dispose する
      // （放置すると EffectPass/ShaderMaterial が回収不能になる）。
      this.target?.removeEffect(this.pass);
    }
    this.pass = target.addEffect({
      fragmentShader: config.fragmentShader,
      uniforms: config.uniforms,
    });
    this.target = target;
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
