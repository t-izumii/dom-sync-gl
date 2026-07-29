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
import { FluidSim } from './fluidSim';

export interface SplashCursorEffectOptions {
  /** 速度・圧力場の解像度（短辺基準）。本家 SIM_RESOLUTION。 */
  simResolution?: number;
  /** 染料の解像度（短辺基準）。本家 DYE_RESOLUTION=1440（負荷を考え既定 1024）。 */
  dyeResolution?: number;
  /** 染料の消散。大きいほど早く消える。本家 DENSITY_DISSIPATION。 */
  densityDissipation?: number;
  /** 速度場の消散。本家 VELOCITY_DISSIPATION。 */
  velocityDissipation?: number;
  /** 圧力場の毎フレーム減衰率。本家 PRESSURE。 */
  pressure?: number;
  /** 圧力 Jacobi 反復回数。本家 PRESSURE_ITERATIONS。 */
  pressureIterations?: number;
  /** 渦度復元の強さ。本家 CURL。 */
  curlStrength?: number;
  /** スプラット半径。本家 SPLAT_RADIUS（内部で /100 + aspect 補正）。 */
  splatRadius?: number;
  /** マウス移動量 → 速度への係数。本家 SPLAT_FORCE。 */
  splatForce?: number;
  /** 染料の勾配から擬似法線を立てて陰影を付ける。本家 SHADING。 */
  shading?: boolean;
  /** HSV 巡回のレインボー色。off で固定色。本家 RAINBOW_MODE。 */
  rainbowMode?: boolean;
  /** rainbowMode=false のときの固定色。本家 COLOR。 */
  color?: string;
  /** レインボー色の切替速度。本家 COLOR_UPDATE_SPEED。 */
  colorUpdateSpeed?: number;
}

/** 本家 HSVtoRGB(h, 1, 1) の移植（結果を out に書き込む）。 */
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

/**
 * スプラッシュカーソル ポストエフェクト（React Bits "Splash Cursor" の移植）。
 *
 * Pavel Dobryakov 系の Navier-Stokes 流体シミュレーション（{@link FluidSim}）を
 * カーソル移動で駆動し、色付きインクが渦を巻いて広がる。最終合成パス
 * （旧 composite.frag.glsl の TSL 化）で染料（dye）を inputTexture に加算合成する。
 * クリックで放射状バースト。
 */
export class SplashCursorEffect extends BaseEffect {
  /** sim 解像度（短辺基準）。GUI で変更すると RT 再構築。 */
  public simResolution: number;
  /** dye 解像度（短辺基準）。GUI で変更すると RT 再構築。 */
  public dyeResolution: number;
  public densityDissipation: number;
  public velocityDissipation: number;
  public pressure: number;
  public pressureIterations: number;
  public curlStrength: number;
  public splatRadius: number;
  public splatForce: number;
  public shading: boolean;
  public rainbowMode: boolean;
  /** 固定色（lil-gui addColor 対応）。 */
  public readonly color: THREE.Color;
  public colorUpdateSpeed: number;

  private renderer: THREE.WebGPURenderer | null = null;
  private sim: FluidSim | null = null;

  // 合成パスのノード（構築時に一度だけグラフへ組み込み、以後は .value 更新のみ）
  private readonly _tDye = texture();
  private readonly _uTexelSize = uniform(new THREE.Vector2(1, 1));
  private readonly _uShading = uniform(1);

  private _lastTime = -1;
  private readonly _prevMouse = new THREE.Vector2(0.5, 0.5);
  private _hasPrevMouse = false;

  /** 現在のポインタ色（本家 pointer.color。COLOR_UPDATE_SPEED 間隔で巡回）。 */
  private readonly _pointerColor = new THREE.Color();
  private _colorTimer = 0;

  /** pointerdown で積み、次の update で消費するクリック位置（UV・左上原点 = sim の uv 系）。 */
  private readonly _pendingClicks: Array<{ x: number; y: number }> = [];
  private readonly _abort = new AbortController();

  // 一時オブジェクト（毎フレームの GC 回避）
  private readonly _tmpColor = new THREE.Color();
  private readonly _tmpSize = new THREE.Vector2();

  constructor(options: SplashCursorEffectOptions = {}) {
    super();
    this.simResolution = options.simResolution ?? 128;
    this.dyeResolution = options.dyeResolution ?? 1440;
    this.densityDissipation = options.densityDissipation ?? 3.5;
    this.velocityDissipation = options.velocityDissipation ?? 2;
    this.pressure = options.pressure ?? 0.1;
    this.pressureIterations = options.pressureIterations ?? 20;
    this.curlStrength = options.curlStrength ?? 3;
    this.splatRadius = options.splatRadius ?? 0.2;
    this.splatForce = options.splatForce ?? 6000;
    this.shading = options.shading ?? true;
    this.rainbowMode = options.rainbowMode ?? true;
    // 色忠実性: 本家は hex を sRGB→linear 変換せず生 float のまま uniform に渡す。
    // 中間 RT への描画は色空間変換を通らないため NoColorSpace で変換を回避する。
    this.color = new THREE.Color().setStyle(options.color ?? '#ff0000', THREE.NoColorSpace);
    this.colorUpdateSpeed = options.colorUpdateSpeed ?? 10;

    this._generateColor(this._pointerColor);

    // クリック（放射状バースト）は EffectManager から渡ってこないので自前で張る。
    // dispose() 時に AbortController でまとめて解除。
    window.addEventListener(
      'pointerdown',
      (e) => {
        const w = window.innerWidth || 1;
        const h = window.innerHeight || 1;
        // sim の uv 系(左上原点・Y 下向き)に合わせる。clientY は元々 Y 下向き
        // なのでそのまま正規化する(Y 上向きへの反転はしない)。
        this._pendingClicks.push({ x: e.clientX / w, y: e.clientY / h });
      },
      { signal: this._abort.signal },
    );
  }

  /** 本家 generateColor() の移植。rainbow は HSV 巡回、固定色も 0.15 倍で暗くする。 */
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

  _setRenderer(renderer: THREE.WebGPURenderer): void {
    this.renderer = renderer;
    this.sim = new FluidSim(renderer);
    this.sim.buildFramebuffers(this.simResolution, this.dyeResolution);
    this._updateScreenTexel();
  }

  protected getConfig(): BaseEffectConfig {
    // composite（本家 displayShaderSource + render() の blendFunc をまとめて再現）:
    // uShading 有効時は dye の左右上下勾配から擬似法線を立て、正面ライトの拡散反射で
    // インクに立体感を付ける（本家 SHADING と同じ式）。
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

        // GLSL の if (uShading > 0.5) 分岐は uniform 駆動の select に置き換える
        const shaded = select(this._uShading.greaterThan(0.5), c.mul(diffuse), c);

        // 本家は display パスの出力 vec4(c, max(c.r,c.g,c.b)) を
        // blendFunc(ONE, ONE_MINUS_SRC_ALPHA) で canvas に重ねる
        // （= result = c + dst * (1 - a)）。単純加算にすると濃いインク部分で
        // 背景が抜けず、本家の見え方にならない。
        const a = max(shaded.r, max(shaded.g, shaded.b));
        const inv = a.oneMinus();

        // 色忠実性: 本家は c を無変換のまま sRGB の canvas に書く（= c は display
        // 参照値）。こちらは最終 pass が linear→sRGB 出力変換を通るため、合成先を
        // 一度 display 空間に上げて本家と同じ式で混ぜ、結果を working(linear) に
        // 戻す。こうすると出力変換で c がそのまま画面値として出る。
        // outputColorSpace は Core 既定の sRGB を前提にする。
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
    const sim = this.sim;
    if (!this.pass || !this.renderer || !sim) return;

    // 本家 calcDeltaTime: dt を 1/60 秒にクランプ（タブ復帰などの巨大 dt で爆発しない）
    let dt = this._lastTime < 0 ? 0 : time - this._lastTime;
    this._lastTime = time;
    dt = Math.min(Math.max(dt, 0), 0.016666);

    // 本家 updateColors: COLOR_UPDATE_SPEED 間隔でポインタ色を巡回
    this._colorTimer += dt * this.colorUpdateSpeed;
    if (this._colorTimer >= 1) {
      this._colorTimer %= 1;
      this._generateColor(this._pointerColor);
    }

    // クリック: 放射状バースト（本家 clickSplat。色 10 倍 + ランダム速度）
    for (const click of this._pendingClicks) {
      this._generateColor(this._tmpColor).multiplyScalar(10);
      const dx = 10 * (Math.random() - 0.5);
      const dy = 30 * (Math.random() - 0.5);
      sim.splat(click.x, click.y, dx, dy, this._tmpColor, this.splatRadius);
      // 本家 updatePointerDownData と同じく、押した位置を prev に据える。
      // これがないと「カーソルが飛んだ先でクリック」したときに、その飛距離が
      // 移動 splat として巨大な速度で注入され、本家には出ないウィスプが暴れる。
      this._prevMouse.set(click.x, click.y);
      this._hasPrevMouse = true;
    }
    this._pendingClicks.length = 0;

    // マウス移動 → splat 注入（本家 splatPointer。delta は aspect 補正 × SPLAT_FORCE）。
    // 本家は移動量の上限を設けない（速いストロークほど強い流れが生まれるのが
    // このエフェクトの核心）ため、テレポート判定等の独自制限は入れない。
    const m = mouse ?? this._prevMouse;
    if (this._hasPrevMouse) {
      let dx = m.x - this._prevMouse.x;
      let dy = m.y - this._prevMouse.y;
      if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
        const aspect = sim.aspect;
        if (aspect < 1) dx *= aspect; // 本家 correctDeltaX
        if (aspect > 1) dy /= aspect; // 本家 correctDeltaY
        sim.splat(m.x, m.y, dx * this.splatForce, dy * this.splatForce, this._pointerColor, this.splatRadius);
      }
    }
    this._prevMouse.copy(m);
    this._hasPrevMouse = true;

    // シミュレーションを 1 ステップ進める（RT の保存・復元は FluidSim 側が行う）
    if (dt > 0) {
      sim.step(dt, {
        curl: this.curlStrength,
        pressure: this.pressure,
        pressureIterations: this.pressureIterations,
        velocityDissipation: this.velocityDissipation,
        densityDissipation: this.densityDissipation,
      });
    }

    // ping-pong の swap で read 側が毎フレーム入れ替わるため、texture ノードの
    // .value を差し替える（setUniform は UniformNode 用なので直接更新する）
    const dyeTexture = sim.dyeTexture;
    if (dyeTexture) this._tDye.value = dyeTexture;
    this._uShading.value = this.shading ? 1 : 0;
  }

  resize(): void {
    // 本家はリサイズ時に copy パスで内容を引き継ぐが、デモ用途では再構築で十分
    // （流体状態はクリアされる）。
    this.sim?.buildFramebuffers(this.simResolution, this.dyeResolution);
    this._updateScreenTexel();
    const dyeTexture = this.sim?.dyeTexture;
    if (dyeTexture) this._tDye.value = dyeTexture;
  }

  setupGUI(gui: GUI): GUI {
    const folder = gui.addFolder('スプラッシュカーソル (Splash cursor)');
    folder.add(this, 'enabled').name('有効');

    const rebuild = () => this.resize();
    const sim = folder.addFolder('シミュレーション');
    sim.add(this, 'simResolution', [32, 64, 128, 256]).name('sim 解像度').onFinishChange(rebuild);
    sim.add(this, 'dyeResolution', [256, 512, 1024, 1440]).name('dye 解像度').onFinishChange(rebuild);
    sim.add(this, 'densityDissipation', 0, 10, 0.1).name('密度消散');
    sim.add(this, 'velocityDissipation', 0, 5, 0.1).name('速度消散');
    sim.add(this, 'pressure', 0, 1, 0.01).name('圧力');
    sim.add(this, 'pressureIterations', 1, 50, 1).name('圧力反復');
    sim.add(this, 'curlStrength', 0, 50, 1).name('渦度 (CURL)');

    const splat = folder.addFolder('スプラット');
    splat.add(this, 'splatRadius', 0.01, 1, 0.01).name('スプラット半径');
    splat.add(this, 'splatForce', 1000, 12000, 100).name('スプラット力');

    const render = folder.addFolder('描画');
    render.add(this, 'shading').name('シェーディング');
    render.add(this, 'rainbowMode').name('レインボー');
    render.addColor(this, 'color').name('固定色');

    return folder;
  }

  dispose(): void {
    this._abort.abort();
    this._pendingClicks.length = 0;
    this.sim?.dispose();
    this.sim = null;
    this.renderer = null;
    this.pass = null;
  }
}
