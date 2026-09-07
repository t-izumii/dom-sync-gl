/**
 * マウス軌跡に沿ってインク雲を注入する流体エフェクト（post 系）。
 *
 * ビジュアルは splashCursor と同じ「dye をマウス軌跡に splat し、
 * 法線ベースの shading を掛けて画面に合成する」もの。違いは流体の解き方で、
 * splashCursor が RenderTarget への blit 連鎖なのに対し、こちらは
 * WebGPU コンピュートシェーダー（`FluidCompute`）で解く。
 *
 * そのため **WebGPU バックエンド専用**。WebGL 2 フォールバック時は
 * dye テクスチャが 1x1 透明のまま = 入力を素通しする完全な no-op になり、
 * エラーも警告も出さない（`_computeReady` を立てないことで compute の
 * ディスパッチ自体を止める）。GUI だけは「WebGPU 専用」と表示して無効化する。
 *
 * 旧実装はマウス位置に丸いグローを出すだけのものだったが、`radius` は
 * splat 半径、`color` はインク色として意味を引き継いでいるため、
 * `new MouseEffect()` はそのまま動く。
 */
import * as THREE from 'three/webgpu';
import {
  clamp,
  colorSpaceToWorking,
  dot,
  length,
  max,
  normalize,
  select,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
  workingToColorSpace,
} from 'three/tsl';
import type GUI from 'lil-gui';
import { BaseEffect, type BaseEffectConfig } from '../../index';
import { FluidCompute } from './fluidCompute';

export interface MouseEffectOptions {
  /** splat 半径。旧グローの radius から意味を引き継ぐ */
  radius?: number;
  /** インク色。rainbowMode=false のときに使う。旧グローの color から引き継ぐ */
  color?: string;
  simResolution?: number;
  dyeResolution?: number;
  densityDissipation?: number;
  velocityDissipation?: number;
  pressure?: number;
  /** 内部で N 以上の最小の奇数に丸められる（ping-pong のパリティ維持のため） */
  pressureIterations?: number;
  curlStrength?: number;
  splatForce?: number;
  /**
   * 1 フレームに積める splat の上限。`uniformArray` の固定長としてノードグラフに
   * 焼き込まれるため**コンストラクタ時のみ指定可**（GUI・実行時の変更は不可）。
   * 溢れた分は最新の K 個が採用される。
   */
  maxSplatsPerFrame?: number;
  shading?: boolean;
  rainbowMode?: boolean;
  colorUpdateSpeed?: number;
}

/**
 * ノードグラフは register 時に一度きりしか組まれないため、dye の texture ノードは
 * 常に有効な Texture を指している必要がある。WebGL フォールバック時はこの 1x1
 * 透明テクスチャのまま = 合成結果が入力と一致する no-op になる。
 */
const placeholderDye = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
placeholderDye.needsUpdate = true;

function hsvToRGB(h: number, out: THREE.Color): THREE.Color {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const q = 1 - f;
  let r = 0;
  let g = 0;
  let b = 0;
  switch (i % 6) {
    case 0: r = 1; g = f; b = 0; break;
    case 1: r = q; g = 1; b = 0; break;
    case 2: r = 0; g = 1; b = f; break;
    case 3: r = 0; g = q; b = 1; break;
    case 4: r = f; g = 0; b = 1; break;
    case 5: r = 1; g = 0; b = q; break;
  }
  return out.setRGB(r, g, b, THREE.NoColorSpace);
}

export class MouseEffect extends BaseEffect {
  public radius: number;
  public readonly color: THREE.Color;
  public simResolution: number;
  public dyeResolution: number;
  public densityDissipation: number;
  public velocityDissipation: number;
  public pressure: number;
  public pressureIterations: number;
  public curlStrength: number;
  public splatForce: number;
  public shading: boolean;
  public rainbowMode: boolean;
  public colorUpdateSpeed: number;

  /** ノードグラフに焼き込まれるため実行時変更不可。GUI にも出さない。 */
  private readonly maxSplatsPerFrame: number;

  private renderer: THREE.WebGPURenderer | null = null;
  private fluid: FluidCompute | null = null;

  /**
   * compute を発行してよいかのフラグ。renderer.init() の解決後に WebGPU だと
   * 確定して初めて true になる。判定確定前の数フレームも false のまま
   * `update()` を素通りさせることで、初期化前の `renderer.compute()` 呼び出しで
   * three.js が警告を出すのを防ぐ。
   */
  private _computeReady = false;
  private _backendResolved = false;
  private _webgpuSupported = false;
  private _localDisposed = false;

  /**
   * `setupGUI()` が返したフォルダ。バックエンド確定は GUI 構築より後なので、
   * 非対応と分かった時点で無効化するために自前で保持する
   * （`BaseEffect._guiFolder` は private で参照できない）。破棄は `_dispose()` 側の責務。
   */
  private _guiRef: GUI | null = null;

  private readonly _tDye = texture(placeholderDye);
  private readonly _uTexelSize = uniform(new THREE.Vector2(1, 1));
  private readonly _uShading = uniform(1);

  private _lastTime = -1;
  private readonly _prevMouse = new THREE.Vector2(0.5, 0.5);
  private _hasPrevMouse = false;

  private readonly _pointerColor = new THREE.Color();
  private _colorTimer = 0;

  private readonly _pendingClicks: Array<{ x: number; y: number }> = [];
  private readonly _abort = new AbortController();

  private readonly _tmpColor = new THREE.Color();
  private readonly _tmpSize = new THREE.Vector2();

  constructor(options: MouseEffectOptions = {}) {
    super();

    // 旧グローの radius は「グロー半径」だったが splat 半径に意味が変わったため、
    // 既定値も splashCursor の splatRadius に揃える。
    this.radius = options.radius ?? 0.2;
    this.color = new THREE.Color().setStyle(options.color ?? '#ff00ff', THREE.NoColorSpace);
    this.simResolution = options.simResolution ?? 128;
    // compute 版の splat は dye 全面のコピーを伴うため、splashCursor の 1440 では重い。
    this.dyeResolution = options.dyeResolution ?? 512;
    this.densityDissipation = options.densityDissipation ?? 3.5;
    this.velocityDissipation = options.velocityDissipation ?? 2;
    this.pressure = options.pressure ?? 0.1;
    this.pressureIterations = options.pressureIterations ?? 20;
    this.curlStrength = options.curlStrength ?? 3;
    this.splatForce = options.splatForce ?? 6000;
    this.maxSplatsPerFrame = options.maxSplatsPerFrame ?? 8;
    this.shading = options.shading ?? true;
    this.rainbowMode = options.rainbowMode ?? true;
    this.colorUpdateSpeed = options.colorUpdateSpeed ?? 10;

    this._generateColor(this._pointerColor);

    window.addEventListener(
      'pointerdown',
      (e) => {
        const w = window.innerWidth || 1;
        const h = window.innerHeight || 1;
        this._pendingClicks.push({ x: e.clientX / w, y: e.clientY / h });
      },
      { signal: this._abort.signal },
    );
  }

  private _generateColor(out: THREE.Color): THREE.Color {
    if (this.rainbowMode) {
      hsvToRGB(Math.random(), out);
    } else {
      out.copy(this.color);
    }
    return out.multiplyScalar(0.15);
  }

  private _updateScreenTexel(): void {
    if (!this.renderer) return;
    this.renderer.getDrawingBufferSize(this._tmpSize);
    this._uTexelSize.value.set(
      1 / Math.max(1, this._tmpSize.x),
      1 / Math.max(1, this._tmpSize.y),
    );
  }

  /**
   * WebGPU 判定はここで行う。device 取得に失敗すると three 側が `renderer.backend`
   * を WebGL フォールバックへ**再代入**するため、コンストラクタ直後や
   * `_setRenderer()` の時点の backend はあてにならない。init() の解決を待つ。
   * init() は冪等なので基底クラスの呼び出しと二重になっても安全。
   */
  _attachRenderer(renderer: THREE.WebGPURenderer): void {
    super._attachRenderer(renderer);
    this.renderer = renderer;

    void Promise.resolve(renderer.init()).then(
      () => {
        if (this._localDisposed) return;
        const backend = (
          renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }
        ).backend;
        this._webgpuSupported = backend?.isWebGPUBackend === true;
        this._backendResolved = true;

        if (!this._webgpuSupported) {
          this._applyUnsupportedGUI();
          if (import.meta.env?.DEV) {
            console.info(
              '[MouseEffect] WebGPU バックエンドではないため無効化しました。',
            );
          }
          return;
        }

        this.fluid = new FluidCompute(renderer, this._computeOptions());
        this.fluid.build();
        this._syncDyeTexture();
        this._updateScreenTexel();
        this._computeReady = true;
      },
      () => {},
    );
  }

  private _computeOptions() {
    return {
      simResolution: this.simResolution,
      dyeResolution: this.dyeResolution,
      pressureIterations: this.pressureIterations,
      maxSplatsPerFrame: this.maxSplatsPerFrame,
    };
  }

  private _syncDyeTexture(): void {
    const dye = this.fluid?.dyeTexture;
    if (dye) this._tDye.value = dye;
  }

  /** 解像度・圧力反復のようにリソース確保を伴う変更の反映口。 */
  private _rebuildFluid(): void {
    if (!this.fluid) return;
    this.fluid.setOptions(this._computeOptions());
    this.fluid.build();
    this._syncDyeTexture();
    this._updateScreenTexel();
  }

  /**
   * lil-gui の `GUI` には `disable()` が無い（`Controller` のみ）ため、
   * 配下のコントローラを再帰的に無効化する。
   */
  private _applyUnsupportedGUI(): void {
    const folder = this._guiRef;
    if (!folder) return;
    folder.title('マウス流体 (WebGPU 専用 — この環境では無効)');
    for (const controller of folder.controllersRecursive()) controller.disable();
  }

  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: ({ inputTexture, uv }) => {
        const tDye = this._tDye;
        const texel = this._uTexelSize;

        const c = tDye.rgb;

        const lc = tDye.sample(uv.sub(vec2(texel.x, 0.0))).rgb;
        const rc = tDye.sample(uv.add(vec2(texel.x, 0.0))).rgb;
        const tc = tDye.sample(uv.add(vec2(0.0, texel.y))).rgb;
        const bc = tDye.sample(uv.sub(vec2(0.0, texel.y))).rgb;

        const dx = length(rc).sub(length(lc));
        const dy = length(tc).sub(length(bc));

        const n = normalize(vec3(dx, dy, length(texel)));
        const l = vec3(0.0, 0.0, 1.0);
        const diffuse = clamp(dot(n, l).add(0.7), 0.7, 1.0);

        const shaded = select(this._uShading.greaterThan(0.5), c.mul(diffuse), c);

        // dye が vec4(0) なら a=0 / inv=1 となり base がそのまま出る。WebGL
        // フォールバック時に placeholder のままで完全な no-op になる要。
        const a = max(shaded.r, max(shaded.g, shaded.b));
        const inv = a.oneMinus();

        // インク雲は sRGB 表示空間で合成する（本家 splashCursor と同じ絵にする）。
        const base = inputTexture;
        const baseDisplay = workingToColorSpace(base, THREE.SRGBColorSpace);
        const outDisplay = vec4(
          shaded.add(baseDisplay.rgb.mul(inv)),
          a.add(base.a.mul(inv)),
        );
        return colorSpaceToWorking(outDisplay, THREE.SRGBColorSpace);
      },
      uniforms: {
        uTexelSize: this._uTexelSize,
        uShading: this._uShading,
      },
    };
  }

  update(time: number, mouse?: THREE.Vector2): void {
    // WebGL フォールバック時・バックエンド確定前はここで完全に止まる。
    const fluid = this.fluid;
    if (!this._computeReady || !fluid || !this.pass) return;

    let dt = this._lastTime < 0 ? 0 : time - this._lastTime;
    this._lastTime = time;
    dt = Math.min(Math.max(dt, 0), 0.016666);
    // dt=0 のフレームは step を飛ばす。ping-pong のパリティが自明に保たれ、
    // 積んでいない splat は次フレームへ持ち越される。
    if (dt <= 0) return;

    this._colorTimer += dt * this.colorUpdateSpeed;
    if (this._colorTimer >= 1) {
      this._colorTimer %= 1;
      this._generateColor(this._pointerColor);
    }

    const aspect = fluid.aspect;
    // splat には左上原点 UV の値をそのまま渡す。compute 側の Y 軸の向きの
    // 都合（SPLAT_VELOCITY_Y_SIGN）は FluidCompute.addSplat() が吸収するので、
    // ここで符号を触らない（二重に掛けると打ち消し合って追えなくなる）。
    // splat 半径は fluidSim.splat() と同じスケールへ変換してから渡す
    // （FluidCompute 側は受け取った値をそのまま使う契約）。
    let splatRadius = this.radius / 100;
    if (aspect > 1) splatRadius *= aspect;

    for (const click of this._pendingClicks) {
      this._generateColor(this._tmpColor).multiplyScalar(10);
      fluid.addSplat({
        x: click.x,
        y: click.y,
        dx: 10 * (Math.random() - 0.5),
        dy: 30 * (Math.random() - 0.5),
        r: this._tmpColor.r,
        g: this._tmpColor.g,
        b: this._tmpColor.b,
        radius: splatRadius,
      });
      this._prevMouse.set(click.x, click.y);
      this._hasPrevMouse = true;
    }
    this._pendingClicks.length = 0;

    const m = mouse ?? this._prevMouse;
    if (this._hasPrevMouse) {
      let dx = m.x - this._prevMouse.x;
      let dy = m.y - this._prevMouse.y;
      if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
        if (aspect < 1) dx *= aspect;
        if (aspect > 1) dy /= aspect;
        fluid.addSplat({
          x: m.x,
          y: m.y,
          dx: dx * this.splatForce,
          dy: dy * this.splatForce,
          r: this._pointerColor.r,
          g: this._pointerColor.g,
          b: this._pointerColor.b,
          radius: splatRadius,
        });
      }
    }
    this._prevMouse.copy(m);
    this._hasPrevMouse = true;

    fluid.step(dt, {
      curl: this.curlStrength,
      pressure: this.pressure,
      velocityDissipation: this.velocityDissipation,
      densityDissipation: this.densityDissipation,
    });

    this._syncDyeTexture();
    this._uShading.value = this.shading ? 1 : 0;
  }

  resize(): void {
    this._rebuildFluid();
  }

  setupGUI(gui: GUI): GUI {
    const folder = gui.addFolder('マウス流体 (Mouse fluid)');
    this._guiRef = folder;
    folder.add(this, 'enabled').name('有効');

    const rebuild = () => this._rebuildFluid();
    const sim = folder.addFolder('シミュレーション');
    sim.add(this, 'simResolution', [64, 128, 256]).name('sim 解像度').onFinishChange(rebuild);
    sim.add(this, 'dyeResolution', [256, 512, 1024]).name('dye 解像度').onFinishChange(rebuild);
    sim.add(this, 'densityDissipation', 0, 10, 0.1).name('密度消散');
    sim.add(this, 'velocityDissipation', 0, 5, 0.1).name('速度消散');
    sim.add(this, 'pressure', 0, 1, 0.01).name('圧力');
    sim
      .add(this, 'pressureIterations', 1, 50, 1)
      .name('圧力反復 (内部で奇数に丸め)')
      .onFinishChange(rebuild);
    sim.add(this, 'curlStrength', 0, 50, 1).name('渦度 (CURL)');

    const splat = folder.addFolder('スプラット');
    splat.add(this, 'radius', 0.01, 1, 0.01).name('スプラット半径');
    splat.add(this, 'splatForce', 1000, 12000, 100).name('スプラット力');

    const render = folder.addFolder('描画');
    render.add(this, 'shading').name('シェーディング');
    render.add(this, 'rainbowMode').name('レインボー');
    render.addColor(this, 'color').name('固定色');

    // GUI 構築後にバックエンド判定が確定するとは限らないため、
    // 既に「非 WebGPU」と分かっている場合はこの場で無効化する。
    if (this._backendResolved && !this._webgpuSupported) this._applyUnsupportedGUI();

    return folder;
  }

  dispose(): void {
    this._localDisposed = true;
    this._computeReady = false;
    this._abort.abort();
    this._pendingClicks.length = 0;
    // BaseEffect._dispose() は _disposeFeedback() で glRenderer を null にしてから
    // ここへ来るため、renderer には依存しない（FluidCompute が自前保持している）。
    this.fluid?.dispose();
    this.fluid = null;
    this.renderer = null;
    this._guiRef = null;
    this.pass = null;
  }
}
