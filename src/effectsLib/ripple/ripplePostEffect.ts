import * as THREE from 'three/webgpu';
import {
  clamp,
  dot,
  exp,
  float,
  max,
  mix,
  normalize,
  pow,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { Node, TextureNode, UniformNode } from 'three/webgpu';
import type GUI from 'lil-gui';
import { BaseEffect, type BaseEffectConfig } from '../../index';

export interface RipplePostEffectOptions {
  resolution?: number;
  moveThreshold?: number;

  speed?: number;
  damping?: number;
  splatRadius?: number;
  splatStrength?: number;

  distortion?: number;
  normalScale?: number;
  specularPower?: number;
  specularIntensity?: number;
  lightDir?: THREE.Vector3;
}

const placeholderTexture = new THREE.DataTexture(
  new Uint8Array([0, 0, 0, 0]),
  1,
  1,
);
placeholderTexture.needsUpdate = true;

export class RipplePostEffect extends BaseEffect {
  public speed: number;
  public damping: number;
  public splatRadius: number;
  public splatStrength: number;

  public distortion: number;
  public normalScale: number;
  public specularPower: number;
  public specularIntensity: number;
  private readonly lightDir: THREE.Vector3;

  public resolution: number;
  private readonly moveThreshold: number;

  private renderer: THREE.WebGPURenderer | null = null;
  private read: THREE.RenderTarget | null = null;
  private write: THREE.RenderTarget | null = null;
  private readonly simMaterial: THREE.MeshBasicNodeMaterial;
  private readonly quad: THREE.QuadMesh;
  private cleared = false;

  private readonly simNodes: {
    uPrev: TextureNode;
    uGridSize: UniformNode<THREE.Vector2>;
    uSplatPos: UniformNode<THREE.Vector2>;
    uSplatAmount: UniformNode<number>;
    uSplatRadius: UniformNode<number>;
    uSpeed: UniformNode<number>;
    uDamping: UniformNode<number>;
  };
  private readonly postNodes: {
    uRippleTex: TextureNode;
    uTexelSize: UniformNode<THREE.Vector2>;
    uDistortion: UniformNode<number>;
    uNormalScale: UniformNode<number>;
    uLightDir: UniformNode<THREE.Vector3>;
    uSpecularPower: UniformNode<number>;
    uSpecularIntensity: UniformNode<number>;
  };

  private _gridW = 1;
  private _gridH = 1;

  constructor(options: RipplePostEffectOptions = {}) {
    super();
    this.resolution = Math.max(16, Math.floor(options.resolution ?? 320));
    this.moveThreshold = options.moveThreshold ?? 0.0005;

    this.speed = options.speed ?? 0.45;
    this.damping = options.damping ?? 0.996;
    this.splatRadius = options.splatRadius ?? 3;
    this.splatStrength = options.splatStrength ?? 0.6;

    this.distortion = options.distortion ?? 0.3;
    this.normalScale = options.normalScale ?? 6.0;
    this.specularPower = options.specularPower ?? 60.0;
    this.specularIntensity = options.specularIntensity ?? 1.0;
    this.lightDir = options.lightDir ?? new THREE.Vector3(-3.0, 10.0, 3.0);

    this.simNodes = {
      uPrev: texture(placeholderTexture),
      uGridSize: uniform(new THREE.Vector2(1, 1)),
      uSplatPos: uniform(new THREE.Vector2(0.5, 0.5)),
      uSplatAmount: uniform(0),
      uSplatRadius: uniform(this.splatRadius),
      uSpeed: uniform(this.speed),
      uDamping: uniform(this.damping),
    };
    this.postNodes = {
      uRippleTex: texture(placeholderTexture),
      uTexelSize: uniform(new THREE.Vector2(1, 1)),
      uDistortion: uniform(this.distortion),
      uNormalScale: uniform(this.normalScale),
      uLightDir: uniform(this.lightDir),
      uSpecularPower: uniform(this.specularPower),
      uSpecularIntensity: uniform(this.specularIntensity),
    };

    this.simMaterial = new THREE.MeshBasicNodeMaterial();
    // 波の高さは符号付きの数値。colorNode の色処理では負値が 0 に丸められる。
    this.simMaterial.fragmentNode = this.buildSimNode();
    this.simMaterial.depthTest = false;
    this.simMaterial.depthWrite = false;
    this.simMaterial.blending = THREE.NoBlending;
    this.quad = new THREE.QuadMesh(this.simMaterial);
  }

  private buildSimNode(): Node {
    const { uPrev, uGridSize, uSplatPos, uSplatAmount, uSplatRadius, uSpeed, uDamping } =
      this.simNodes;
    const uvN = uv();
    const texel = vec2(1.0, 1.0).div(uGridSize);

    const p = uPrev.sample(uvN);
    const h = p.r;
    const hPrev = p.g;

    const hL = uPrev.sample(uvN.sub(vec2(texel.x, 0.0))).r;
    const hR = uPrev.sample(uvN.add(vec2(texel.x, 0.0))).r;
    const hD = uPrev.sample(uvN.sub(vec2(0.0, texel.y))).r;
    const hU = uPrev.sample(uvN.add(vec2(0.0, texel.y))).r;
    const lap = hL.add(hR).add(hD).add(hU).sub(h.mul(4.0));

    let hNext: Node = h.mul(2.0).sub(hPrev).add(uSpeed.mul(lap)).mul(uDamping);

    const df = uvN.sub(uSplatPos).mul(uGridSize);
    const r2 = max(uSplatRadius.mul(uSplatRadius), 1e-4);
    hNext = hNext.add(uSplatAmount.mul(exp(dot(df, df).div(r2).mul(-1.0))));

    const m = 0.04;
    const edge = smoothstep(0.0, m, uvN.x)
      .mul(smoothstep(0.0, m, float(1.0).sub(uvN.x)))
      .mul(smoothstep(0.0, m, uvN.y))
      .mul(smoothstep(0.0, m, float(1.0).sub(uvN.y)));
    hNext = hNext.mul(mix(0.9, 1.0, edge));

    return vec4(hNext, h, 0.0, 1.0);
  }

  private makeTarget(w: number, h: number): THREE.RenderTarget {
    return new THREE.RenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  private buildTargets(aspect: number): void {
    if (!this.renderer) return;

    this._gridW = Math.max(16, Math.round(this.resolution));
    this._gridH = Math.max(16, Math.round(this.resolution / aspect));

    this.read?.dispose();
    this.write?.dispose();
    this.read = this.makeTarget(this._gridW, this._gridH);
    this.write = this.makeTarget(this._gridW, this._gridH);
    this.cleared = false;

    this.simNodes.uGridSize.value.set(this._gridW, this._gridH);
    this.simNodes.uPrev.value = this.read.texture;
    this.postNodes.uRippleTex.value = this.read.texture;
    this.postNodes.uTexelSize.value.set(1 / this._gridW, 1 / this._gridH);
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
    const sz = renderer.getSize(new THREE.Vector2());
    this.buildTargets(sz.x / sz.y || 1);
  }

  protected getConfig(): BaseEffectConfig {
    const n = this.postNodes;
    return {
      outputNode: (ctx) => {
        const uvN = ctx.uv;
        const hL = n.uRippleTex.sample(uvN.sub(vec2(n.uTexelSize.x, 0.0))).r;
        const hR = n.uRippleTex.sample(uvN.add(vec2(n.uTexelSize.x, 0.0))).r;
        const hD = n.uRippleTex.sample(uvN.sub(vec2(0.0, n.uTexelSize.y))).r;
        const hU = n.uRippleTex.sample(uvN.add(vec2(0.0, n.uTexelSize.y))).r;
        const grad = vec2(hR.sub(hL), hU.sub(hD));

        const color = ctx.inputTexture.sample(
          clamp(uvN.add(grad.mul(n.uDistortion)), 0.0, 1.0),
        );

        const normal = normalize(
          vec3(
            grad.x.mul(-1.0).mul(n.uNormalScale),
            1.0,
            grad.y.mul(-1.0).mul(n.uNormalScale),
          ),
        );
        const specular = pow(
          max(dot(normal, normalize(n.uLightDir)), 0.0),
          n.uSpecularPower,
        ).mul(n.uSpecularIntensity);

        return vec4(color.rgb.add(specular), color.a);
      },
      uniforms: {
        uTexelSize: n.uTexelSize,
        uDistortion: n.uDistortion,
        uNormalScale: n.uNormalScale,
        uLightDir: n.uLightDir,
        uSpecularPower: n.uSpecularPower,
        uSpecularIntensity: n.uSpecularIntensity,
      },
    };
  }

  update(_time: number, mouse?: THREE.Vector2): void {
    const renderer = this.renderer;
    if (!this.pass || !renderer || !this.read || !this.write) return;

    if (!this.cleared) {
      this.clearTargets();
      this.cleared = true;
    }

    const sn = this.simNodes;

    const moved = mouse
      ? this.uMouse.value.distanceTo(this.mouseMotion.prev) > this.moveThreshold
      : false;
    sn.uSplatPos.value.copy(this.uMouse.value);
    sn.uSplatAmount.value = moved ? this.splatStrength : 0.0;

    sn.uPrev.value = this.read.texture;
    sn.uSplatRadius.value = this.splatRadius;
    sn.uSpeed.value = this.speed;
    sn.uDamping.value = this.damping;

    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(this.write);
    this.quad.render(renderer);
    renderer.setRenderTarget(prevRT);

    const tmp = this.read;
    this.read = this.write;
    this.write = tmp;

    const pn = this.postNodes;
    pn.uRippleTex.value = this.read.texture;
    pn.uDistortion.value = this.distortion;
    pn.uNormalScale.value = this.normalScale;
    pn.uSpecularPower.value = this.specularPower;
    pn.uSpecularIntensity.value = this.specularIntensity;
  }

  setupGUI(gui: GUI): GUI {
    const folder = gui.addFolder('波紋 (Ripple / post)');
    folder.add(this, 'enabled').name('有効');

    const sim = folder.addFolder('シミュレーション');
    sim
      .add(this, 'resolution', [64, 128, 256, 320, 512])
      .name('解像度')
      .onFinishChange(() => this.buildTargets(this.width / this.height || 1));
    sim.add(this, 'speed', 0.05, 0.5, 0.005).name('波速');
    sim.add(this, 'damping', 0.9, 1.0, 0.0005).name('減衰（消える速さ）');
    sim.add(this, 'splatStrength', 0.0, 3.0, 0.01).name('波源の強さ');
    sim.add(this, 'splatRadius', 1, 10, 1).name('波源の半径');

    const render = folder.addFolder('描画');
    render.add(this, 'distortion', 0.0, 1.0, 0.01).name('歪み');
    render.add(this, 'normalScale', 0.0, 30.0, 0.1).name('法線の傾き');
    render.add(this, 'specularPower', 1.0, 200.0, 1.0).name('鏡面の鋭さ');
    render.add(this, 'specularIntensity', 0.0, 5.0, 0.01).name('鏡面の強さ');

    return folder;
  }

  resize(width: number, height: number): void {
    this.buildTargets(width / height || 1);
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
