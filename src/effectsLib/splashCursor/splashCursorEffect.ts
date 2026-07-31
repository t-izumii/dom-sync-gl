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
  simResolution?: number;
  dyeResolution?: number;
  densityDissipation?: number;
  velocityDissipation?: number;
  pressure?: number;
  pressureIterations?: number;
  curlStrength?: number;
  splatRadius?: number;
  splatForce?: number;
  shading?: boolean;
  rainbowMode?: boolean;
  color?: string;
  colorUpdateSpeed?: number;
}

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

export class SplashCursorEffect extends BaseEffect {
  public simResolution: number;
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
  public readonly color: THREE.Color;
  public colorUpdateSpeed: number;

  private renderer: THREE.WebGPURenderer | null = null;
  private sim: FluidSim | null = null;

  private readonly _tDye = texture();
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
    this.color = new THREE.Color().setStyle(options.color ?? '#ff0000', THREE.NoColorSpace);
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

  _setRenderer(renderer: THREE.WebGPURenderer): void {
    this.renderer = renderer;
    this.sim = new FluidSim(renderer);
    this.sim.buildFramebuffers(this.simResolution, this.dyeResolution);
    this._updateScreenTexel();
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

        const a = max(shaded.r, max(shaded.g, shaded.b));
        const inv = a.oneMinus();

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

    let dt = this._lastTime < 0 ? 0 : time - this._lastTime;
    this._lastTime = time;
    dt = Math.min(Math.max(dt, 0), 0.016666);

    this._colorTimer += dt * this.colorUpdateSpeed;
    if (this._colorTimer >= 1) {
      this._colorTimer %= 1;
      this._generateColor(this._pointerColor);
    }

    for (const click of this._pendingClicks) {
      this._generateColor(this._tmpColor).multiplyScalar(10);
      const dx = 10 * (Math.random() - 0.5);
      const dy = 30 * (Math.random() - 0.5);
      sim.splat(click.x, click.y, dx, dy, this._tmpColor, this.splatRadius);
      this._prevMouse.set(click.x, click.y);
      this._hasPrevMouse = true;
    }
    this._pendingClicks.length = 0;

    const m = mouse ?? this._prevMouse;
    if (this._hasPrevMouse) {
      let dx = m.x - this._prevMouse.x;
      let dy = m.y - this._prevMouse.y;
      if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
        const aspect = sim.aspect;
        if (aspect < 1) dx *= aspect;
        if (aspect > 1) dy /= aspect;
        sim.splat(m.x, m.y, dx * this.splatForce, dy * this.splatForce, this._pointerColor, this.splatRadius);
      }
    }
    this._prevMouse.copy(m);
    this._hasPrevMouse = true;

    if (dt > 0) {
      sim.step(dt, {
        curl: this.curlStrength,
        pressure: this.pressure,
        pressureIterations: this.pressureIterations,
        velocityDissipation: this.velocityDissipation,
        densityDissipation: this.densityDissipation,
      });
    }

    const dyeTexture = sim.dyeTexture;
    if (dyeTexture) this._tDye.value = dyeTexture;
    this._uShading.value = this.shading ? 1 : 0;
  }

  resize(): void {
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
