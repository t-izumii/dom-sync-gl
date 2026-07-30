import * as THREE from 'three/webgpu';
import { texture, uniform } from 'three/tsl';
import type { TextureNode, UniformNode } from 'three/webgpu';
import type GUI from 'lil-gui';
import { BaseEffect, type BaseEffectConfig } from '../../index';
import { ditherDisplayNode, ditherSimNode } from './ditherCursorNodes';

export interface DitherCursorEffectOptions {
  ditherSize?: number;
  radius?: number;
  exponent?: number;
  decay?: number;
  intensity?: number;
  color?: string;
}

export class DitherCursorEffect extends BaseEffect {
  public ditherSize: number;
  public radius: number;
  public exponent: number;
  public decay: number;
  public intensity: number;
  public readonly color: THREE.Color;

  private renderer: THREE.WebGPURenderer | null = null;
  private read: THREE.RenderTarget | null = null;
  private write: THREE.RenderTarget | null = null;
  private readonly simMaterial: THREE.MeshBasicNodeMaterial;
  private readonly quad: THREE.QuadMesh;

  private _rendererReady = false;
  private _cleared = false;

  private readonly uPrev: TextureNode;
  private readonly tSimulation: TextureNode;
  private readonly uResolution = uniform(new THREE.Vector2(1, 1));
  private readonly uSpeed = uniform(0);
  private readonly uRadius: UniformNode<number>;
  private readonly uDecay: UniformNode<number>;
  private readonly uIntensity: UniformNode<number>;
  private readonly uDitherSize: UniformNode<number>;
  private readonly uExponent: UniformNode<number>;
  private readonly uColor: UniformNode<THREE.Color>;

  private readonly _prevMouse = new THREE.Vector2(0.5, 0.5);
  private _hasPrevMouse = false;
  private _speed = 0;
  private readonly _maxDelta = 0.25;

  constructor(options: DitherCursorEffectOptions = {}) {
    super();
    this.ditherSize = options.ditherSize ?? 4;
    this.radius = options.radius ?? 0.1;
    this.exponent = options.exponent ?? 2.0;
    this.decay = options.decay ?? 0.01;
    this.intensity = options.intensity ?? 0.5;
    this.color = new THREE.Color().setStyle(
      options.color ?? '#FF9FFC',
      THREE.NoColorSpace,
    );

    this.uRadius = uniform(this.radius);
    this.uDecay = uniform(this.decay);
    this.uIntensity = uniform(this.intensity);
    this.uDitherSize = uniform(this.ditherSize);
    this.uExponent = uniform(this.exponent);
    this.uColor = uniform(this.color.clone().convertSRGBToLinear());

    this.read = this.makeTarget(1, 1);
    this.write = this.makeTarget(1, 1);
    this.uPrev = texture(this.read.texture);
    this.tSimulation = texture(this.read.texture);

    this.simMaterial = new THREE.MeshBasicNodeMaterial();
    this.simMaterial.colorNode = ditherSimNode({
      uPrev: this.uPrev,
      uResolution: this.uResolution,
      uTime: this.uTime,
      uMouse: this.uMouse,
      uSpeed: this.uSpeed,
      uRadius: this.uRadius,
      uDecay: this.uDecay,
      uIntensity: this.uIntensity,
    });
    this.simMaterial.depthTest = false;
    this.simMaterial.depthWrite = false;
    this.simMaterial.blending = THREE.NoBlending;
    this.quad = new THREE.QuadMesh(this.simMaterial);
  }

  private makeTarget(w: number, h: number): THREE.RenderTarget {
    return new THREE.RenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  private buildTargets(): void {
    const renderer = this.renderer;
    if (!renderer) return;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, Math.round(size.x));
    const h = Math.max(1, Math.round(size.y));

    this.read?.dispose();
    this.write?.dispose();
    this.read = this.makeTarget(w, h);
    this.write = this.makeTarget(w, h);
    this._cleared = false;

    this.uResolution.value.set(w, h);
    this.uPrev.value = this.read.texture;
    this.tSimulation.value = this.read.texture;
  }

  private clearTargets(): void {
    const r = this.renderer;
    if (!r || !this.read || !this.write) return;
    const prevTarget = r.getRenderTarget();
    const prevColor = r.getClearColor(
      new THREE.Color() as unknown as Parameters<
        THREE.WebGPURenderer['getClearColor']
      >[0],
    );
    const prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.read);
    r.clear();
    r.setRenderTarget(this.write);
    r.clear();
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevColor, prevAlpha);
  }

  _setRenderer(renderer: THREE.WebGPURenderer): void {
    this.renderer = renderer;
    renderer
      .init()
      .then(() => {
        this._rendererReady = true;
      })
      .catch(() => {});
    this.buildTargets();
  }

  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: (ctx) =>
        ditherDisplayNode(ctx, {
          tSimulation: this.tSimulation,
          uDitherSize: this.uDitherSize,
          uExponent: this.uExponent,
          uColor: this.uColor,
        }),
      uniforms: {
        uDitherSize: this.uDitherSize,
        uExponent: this.uExponent,
        uColor: this.uColor as UniformNode<unknown>,
      },
    };
  }

  update(_time: number, mouse?: THREE.Vector2): void {
    const m = mouse ?? this._prevMouse;
    let delta = this._hasPrevMouse ? m.distanceTo(this._prevMouse) : 0;
    if (delta > this._maxDelta) delta = 0;
    this._speed += (delta - this._speed) * 0.1;
    this._prevMouse.copy(m);
    this._hasPrevMouse = true;

    const renderer = this.renderer;
    if (
      !this.pass ||
      !renderer ||
      !this._rendererReady ||
      !this.read ||
      !this.write
    ) {
      return;
    }

    if (!this._cleared) {
      this.clearTargets();
      this._cleared = true;
    }

    this.uPrev.value = this.read.texture;
    this.uSpeed.value = this._speed;
    this.uRadius.value = this.radius;
    this.uDecay.value = this.decay;
    this.uIntensity.value = this.intensity;

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.write);
    this.quad.render(renderer);
    renderer.setRenderTarget(prevTarget);

    const tmp = this.read;
    this.read = this.write;
    this.write = tmp;

    this.tSimulation.value = this.read.texture;
    this.setUniform('uDitherSize', this.ditherSize);
    this.setUniform('uExponent', this.exponent);
    this.uColor.value.copy(this.color).convertSRGBToLinear();
  }

  resize(): void {
    this.buildTargets();
  }

  setupGUI(gui: GUI): GUI {
    const folder = gui.addFolder('ディザカーソル (Dither cursor)');
    folder.add(this, 'enabled').name('有効');
    folder.add(this, 'ditherSize', 1, 16, 1).name('ドットサイズ (px)');
    folder.add(this, 'radius', 0.02, 0.4, 0.005).name('半径');
    folder.add(this, 'exponent', 0.5, 8, 0.1).name('減衰カーブ (exponent)');
    folder.add(this, 'decay', 0.001, 0.05, 0.001).name('減衰速度 (decay)');
    folder.add(this, 'intensity', 0.05, 1, 0.01).name('ブラシの濃さ');
    folder.addColor(this, 'color').name('色');
    return folder;
  }

  dispose(): void {
    this.read?.dispose();
    this.write?.dispose();
    this.simMaterial.dispose();
    this.read = null;
    this.write = null;
    this.renderer = null;
    this.pass = null;
  }
}
