import type { Node, UniformNode, Vector2, WebGPURenderer } from "three/webgpu";
import type GUI from "lil-gui";
import type { EffectContext, EffectTarget, EffectPass } from "../EffectComposer";

export interface BaseEffectConfig {
  /** vec4 の色ノードを返すファクトリ。register 時に一度だけ呼ばれる */
  outputNode: (ctx: EffectContext) => Node;
  /** uniform() で生成したノードの名前つきマップ。setUniform/getUniform で参照される */
  uniforms?: Record<string, UniformNode<unknown>>;
}

/**
 * ポストエフェクトの基底クラス。
 *
 * effect インスタンスは単一 owner・使い捨てで、`new → registered → disposed` の
 * 一方向ライフサイクルを取る。別 owner への再登録・dispose 後の再登録は throw
 * するため、使い回す場合は新しいインスタンスを生成する。
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
    // 二重 register を許すと update の二重実行や owner をまたいだ dispose が
    // 起きるため throw する。
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
      outputNode: config.outputNode,
      uniforms: config.uniforms,
    });
    this.pass.enabled = this._enabled;
  }

  _setRenderer?(_renderer: WebGPURenderer): void;

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

  getUniform(key: string): UniformNode<unknown> | undefined {
    return this.pass?.getUniform(key);
  }

  getPass(): EffectPass | null {
    return this.pass;
  }
}
