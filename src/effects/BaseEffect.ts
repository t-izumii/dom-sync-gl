import type { IUniform, Vector2, WebGLRenderer } from "three";
import type GUI from "lil-gui";
import type { EffectTarget, EffectPass } from "../EffectComposer";

export interface BaseEffectConfig {
  fragmentShader: string;
  uniforms?: { [key: string]: IUniform };
}

export abstract class BaseEffect {
  protected pass: EffectPass | null = null;

  /**
   * GUI の on/off チェックボックスから操作される。false にすると
   * EffectComposer がこのパスをスキップする（lil-gui バインド用に public）。
   */
  private _enabled = true;
  get enabled(): boolean {
    return this._enabled;
  }
  set enabled(value: boolean) {
    this._enabled = value;
    if (this.pass) this.pass.enabled = value;
  }

  protected abstract getConfig(): BaseEffectConfig;

  /**
   * addEffect() 呼び出し時に内部で呼ばれる。直接使わない。
   *
   * 1 インスタンスを `webgl.addEffect()` と `domPlane.addEffect()` の両方に
   * 渡すと、`update()` が同一フレームに 2 回走り内部状態が二重進行する
   * （例: `FluidEffect` の dye が倍速で進む）。DEV では警告を出す。
   */
  _register(target: EffectTarget): void {
    if (this.pass !== null && import.meta.env?.DEV) {
      console.warn(
        "[BaseEffect] 同じ effect インスタンスを複数の target に register しています。" +
        "`webgl.addEffect()` と `domPlane.addEffect()` を併用する場合は別インスタンスを作ってください。"
      );
    }
    const config = this.getConfig();
    this.pass = target.addEffect({
      fragmentShader: config.fragmentShader,
      uniforms: config.uniforms,
    });
    // _register 前に enabled を弄られていた場合に備えて pass に反映
    this.pass.enabled = this._enabled;
  }

  /**
   * Core/DomPlane の addEffect から `_register` の直前に呼ばれる。
   * renderer を必要とするエフェクト（FluidEffect 等）はこれを override して受け取る。
   * @internal
   */
  _setRenderer?(_renderer: WebGLRenderer): void;

  update(_time: number, _mouse?: Vector2): void {}

  resize?(_width: number, _height: number): void;

  /**
   * lil-gui の親 GUI / Folder を受け取り、自分用のフォルダや control を生やす任意フック。
   * `DomSyncGL.addEffect()` / `DomPlane.addEffect()` 経由でエフェクトを登録すると、
   * `showGUI` が無効でない限り自動で呼ばれる。
   *
   * 典型例:
   * ```ts
   * setupGUI(gui: GUI) {
   *   const folder = gui.addFolder('MyEffect');
   *   folder.add(this, 'intensity', 0, 1);
   * }
   * ```
   *
   * @param gui lil-gui の親 GUI（通常は DomSyncGL の root GUI）
   * @returns 作った folder（任意）。DomSyncGL 側で dispose する時の参照に使える。
   */
  setupGUI?(gui: GUI): GUI | void;

  /** リソース解放。サブクラスで RT などを持つ場合に override する。 */
  dispose?(): void;

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
