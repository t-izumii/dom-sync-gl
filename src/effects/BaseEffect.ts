import type { IUniform, Vector2, WebGLRenderer } from "three";
import type GUI from "lil-gui";
import type { EffectTarget, EffectPass } from "../EffectComposer";

export interface BaseEffectConfig {
  fragmentShader: string;
  uniforms?: { [key: string]: IUniform };
}

export abstract class BaseEffect {
  protected pass: EffectPass | null = null;

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
    this.pass.enabled = this._enabled;
  }

  _setRenderer?(_renderer: WebGLRenderer): void;

  update(_time: number, _mouse?: Vector2): void {}

  resize?(_width: number, _height: number): void;

  setupGUI?(gui: GUI): GUI | void;

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
