import * as THREE from 'three/webgpu';
import {
  clamp,
  distance,
  float,
  length,
  select,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec4,
} from 'three/tsl';
import type { Node, TextureNode, UniformNode } from 'three/webgpu';
import type GUI from 'lil-gui';
import { BaseEffect, type BaseEffectConfig } from '../../index';

export interface MouseFlowEffectOptions {
  size?: number;
  strength?: number;
  dissipation?: number;
  falloff?: number;
}

export class MouseFlowEffect extends BaseEffect {
  public strength: number;
  public dissipation: number;
  public falloff: number;

  public size: number;

  private renderer: THREE.WebGPURenderer | null = null;
  private read: THREE.RenderTarget | null;
  private write: THREE.RenderTarget | null;

  private simMaterial: THREE.MeshBasicNodeMaterial | null;
  private quad: THREE.QuadMesh | null;

  private cleared = false;

  private readonly tMap: TextureNode;
  private readonly uDeltaMouse: UniformNode<THREE.Vector2>;
  private readonly uDissipation: UniformNode<number>;
  private readonly uFalloff: UniformNode<number>;
  private readonly tFlow: TextureNode;
  private readonly uStrength: UniformNode<number>;

  private readonly _prevMouse = new THREE.Vector2(0.5, 0.5);
  private readonly _delta = new THREE.Vector2();
  private _hasPrevMouse = false;
  private readonly _maxDelta = 0.1;

  constructor(options: MouseFlowEffectOptions = {}) {
    super();
    this.size = Math.max(16, Math.floor(options.size ?? 64));
    this.strength = options.strength ?? 2.5;
    this.dissipation = options.dissipation ?? 0.8;
    this.falloff = options.falloff ?? 0.2;

    this.read = this.makeTarget();
    this.write = this.makeTarget();

    this.tMap = texture(this.read.texture);
    this.tFlow = texture(this.read.texture);
    this.uDeltaMouse = uniform(new THREE.Vector2());
    this.uDissipation = uniform(this.dissipation);
    this.uFalloff = uniform(this.falloff);
    this.uStrength = uniform(this.strength);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = this.buildSimNode();
    material.depthTest = false;
    material.depthWrite = false;
    material.blending = THREE.NoBlending;
    this.simMaterial = material;
    this.quad = new THREE.QuadMesh(material);
  }

  private makeTarget(): THREE.RenderTarget {
    return new THREE.RenderTarget(this.size, this.size, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      stencilBuffer: false,
      depthBuffer: false,
      colorSpace: THREE.NoColorSpace,
    });
  }

  private buildSimNode(): Node {
    const prev = this.tMap;
    const prevFlow = prev.rg.mul(2.0).sub(1.0).mul(prev.a);

    const deltaLength = length(this.uDeltaMouse).mul(0.5);
    const dist = float(1.0).sub(
      smoothstep(0.0, this.uFalloff, distance(uv(), this.uMouse)),
    );
    const injected = select(
      deltaLength.greaterThan(0.0001),
      this.uDeltaMouse.mul(dist),
      vec2(0.0),
    );

    const flow = prevFlow.add(injected).mul(this.uDissipation);
    return vec4(flow.mul(0.5).add(0.5), 0.0, 1.0);
  }

  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: ({ inputTexture, uv }) => {
        const flow = this.tFlow.rg.mul(2.0).sub(1.0);
        const shifted = uv.sub(flow.mul(this.uStrength));
        return inputTexture.sample(clamp(shifted, 0.0, 1.0));
      },
      uniforms: {
        tFlow: this.tFlow,
        uStrength: this.uStrength,
      },
    };
  }

  _setRenderer(renderer: THREE.WebGPURenderer): void {
    this.renderer = renderer;
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

  update(_time: number, mouse?: THREE.Vector2): void {
    const renderer = this.renderer;
    const quad = this.quad;
    if (!this.pass || !renderer || !quad || !this.read || !this.write) return;

    if (!this.cleared) {
      this.clearTargets();
      this.cleared = true;
    }

    const m = mouse ?? this._prevMouse;
    if (this._hasPrevMouse) {
      this._delta.copy(m).sub(this._prevMouse);
      if (this._delta.lengthSq() > this._maxDelta * this._maxDelta) {
        this._delta.set(0, 0);
      }
    } else {
      this._delta.set(0, 0);
    }
    this._prevMouse.copy(m);
    this._hasPrevMouse = true;

    this.uDeltaMouse.value.copy(this._delta);
    this.uDissipation.value = this.dissipation;
    this.uFalloff.value = this.falloff;
    this.tMap.value = this.read.texture;

    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(this.write);
    quad.render(renderer);
    renderer.setRenderTarget(prevRT);

    const tmp = this.read;
    this.read = this.write;
    this.write = tmp;

    this.setUniform('tFlow', this.read.texture);
    this.setUniform('uStrength', this.strength);
  }

  setupGUI(gui: GUI): GUI {
    const folder = gui.addFolder('マウスフロー (Mouse flow)');
    folder.add(this, 'enabled').name('有効');
    folder.add(this, 'strength', 0.0, 10.0, 0.1).name('歪みの強さ');
    folder.add(this, 'dissipation', 0.8, 1.0, 0.001).name('減衰（消える速さ）');
    folder.add(this, 'falloff', 0.01, 1.0, 0.01).name('影響半径');
    return folder;
  }

  dispose(): void {
    this.read?.dispose();
    this.write?.dispose();
    this.simMaterial?.dispose();
    this.read = null;
    this.write = null;
    this.simMaterial = null;
    this.quad = null;
    this.renderer = null;
    this.pass = null;
  }
}
