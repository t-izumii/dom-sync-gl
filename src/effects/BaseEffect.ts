import type { IUniform, Vector2, WebGLRenderer } from "three";
import type GUI from "lil-gui";
import type { EffectTarget, EffectPass } from "../EffectComposer";

/**
 * テクスチャ生成パス（generator）の設定。ping-pong の FeedbackBuffer で軌跡・流体等の
 * 「状態を時間蓄積したテクスチャ」を作る。`uPrev` / `uMouse` / `uHover` / `uTime` /
 * `uResolution` / `uAspect` は自動供給される。
 */
export interface EffectGenerateConfig {
  fragmentShader: string;
  vertexShader?: string;
  /** ping-pong バッファの1辺解像度（正方）。@default 256 */
  size?: number;
  uniforms?: { [key: string]: IUniform };
}

export interface BaseEffectConfig {
  /**
   * post 合成 shader（`output: 'post'` のとき `tDiffuse` を読む）。generate と併用すると
   * 生成テクスチャが `uGenerated`(sampler2D) として自動で渡る。generator 専用なら省略可。
   */
  fragmentShader?: string;
  uniforms?: { [key: string]: IUniform };
  /** テクスチャ生成パス。`output:{uniform}` で uniform に供給、`output:'post'` で合成素材になる。 */
  generate?: EffectGenerateConfig;
}

/** addEffect の出力モード。`'post'`=合成して描画 / `{uniform}`=生成テクスチャをその uniform に供給。 */
export type EffectOutput = "post" | { uniform: string };

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
    if (!config.fragmentShader) {
      throw new Error(
        "[BaseEffect] post として登録するには getConfig().fragmentShader が必要です。",
      );
    }
    this.pass = target.addEffect({
      fragmentShader: config.fragmentShader,
      uniforms: config.uniforms,
    });
    // _register 前に enabled を弄られていた場合に備えて pass に反映
    this.pass.enabled = this._enabled;
  }

  /**
   * @internal getConfig() の結果を library 側（DomPlane / EffectManager）から読むためのアクセサ。
   * generate / fragmentShader / output を見て配線を分岐するために使う。
   */
  _getConfig(): BaseEffectConfig {
    return this.getConfig();
  }

  /**
   * @internal generate + output:'post' 経路で library が合成 pass を作った後、その pass を
   * effect に紐づける（update()/setUniform()/getUniform()/enabled が効くようにする）。
   */
  _setPass(pass: EffectPass | null): void {
    this.pass = pass;
    if (pass) pass.enabled = this._enabled;
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
