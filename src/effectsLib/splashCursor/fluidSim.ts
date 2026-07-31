import * as THREE from 'three/webgpu';
import {
  abs,
  clamp,
  dot,
  exp,
  length,
  select,
  texture,
  uniform,
  uv,
  vec2,
  vec4,
} from 'three/tsl';

export interface FluidStepParams {
  curl: number;
  pressure: number;
  pressureIterations: number;
  velocityDissipation: number;
  densityDissipation: number;
}

interface DoubleFBO {
  read: THREE.RenderTarget;
  write: THREE.RenderTarget;
  swap(): void;
  dispose(): void;
}

export class FluidSim {
  private renderer: THREE.WebGPURenderer;

  private readonly quad = new THREE.QuadMesh();

  private readonly uTexelSize = uniform(new THREE.Vector2(1, 1));

  private readonly splatTarget = texture();
  private readonly uAspectRatio = uniform(1);
  private readonly uColor = uniform(new THREE.Vector3());
  private readonly uPoint = uniform(new THREE.Vector2());
  private readonly uRadius = uniform(0.0025);

  private readonly advVelSelf = texture();
  private readonly advDyeVelocity = texture();
  private readonly advDyeSource = texture();
  private readonly uAdvDt = uniform(0);
  private readonly uDissipation = uniform(0);

  private readonly curlVelocity = texture();

  private readonly vortVelocity = texture();
  private readonly vortCurl = texture();
  private readonly uCurl = uniform(0);
  private readonly uVortDt = uniform(0);

  private readonly divVelocity = texture();

  private readonly clearTexture = texture();
  private readonly uClearValue = uniform(0.1);

  private readonly prsPressure = texture();
  private readonly prsDivergence = texture();

  private readonly gradPressure = texture();
  private readonly gradVelocity = texture();

  private readonly splatMaterial: THREE.MeshBasicNodeMaterial;
  private readonly advectionVelocityMaterial: THREE.MeshBasicNodeMaterial;
  private readonly advectionDyeMaterial: THREE.MeshBasicNodeMaterial;
  private readonly curlMaterial: THREE.MeshBasicNodeMaterial;
  private readonly vorticityMaterial: THREE.MeshBasicNodeMaterial;
  private readonly divergenceMaterial: THREE.MeshBasicNodeMaterial;
  private readonly clearMaterial: THREE.MeshBasicNodeMaterial;
  private readonly pressureMaterial: THREE.MeshBasicNodeMaterial;
  private readonly gradientSubtractMaterial: THREE.MeshBasicNodeMaterial;
  private readonly materials: THREE.MeshBasicNodeMaterial[];

  private velocity: DoubleFBO | null = null;
  private dye: DoubleFBO | null = null;
  private pressure: DoubleFBO | null = null;
  private divergence: THREE.RenderTarget | null = null;
  private curl: THREE.RenderTarget | null = null;

  private cleared = false;

  private _aspect = 1;

  constructor(renderer: THREE.WebGPURenderer) {
    this.renderer = renderer;

    const make = (fragmentNode: THREE.Node): THREE.MeshBasicNodeMaterial => {
      const material = new THREE.MeshBasicNodeMaterial();
      material.fragmentNode = fragmentNode;
      material.depthTest = false;
      material.depthWrite = false;
      material.blending = THREE.NoBlending;
      return material;
    };

    const texel = this.uTexelSize;

    const neighborUVs = () => {
      const vUv = uv();
      return {
        vUv,
        vL: vUv.sub(vec2(texel.x, 0.0)),
        vR: vUv.add(vec2(texel.x, 0.0)),
        vT: vUv.add(vec2(0.0, texel.y)),
        vB: vUv.sub(vec2(0.0, texel.y)),
      };
    };

    {
      const p0 = uv().sub(this.uPoint);
      const p = vec2(p0.x.mul(this.uAspectRatio), p0.y);
      const splat = exp(dot(p, p).negate().div(this.uRadius)).mul(this.uColor);
      this.splatMaterial = make(vec4(this.splatTarget.xyz.add(splat), 1.0));
    }

    {
      const decay = this.uDissipation.mul(this.uAdvDt).add(1.0);

      const selfCoord = uv().sub(this.advVelSelf.xy.mul(texel).mul(this.uAdvDt));
      this.advectionVelocityMaterial = make(this.advVelSelf.sample(selfCoord).div(decay));

      const dyeCoord = uv().sub(this.advDyeVelocity.xy.mul(texel).mul(this.uAdvDt));
      this.advectionDyeMaterial = make(this.advDyeSource.sample(dyeCoord).div(decay));
    }

    {
      const { vL, vR, vT, vB } = neighborUVs();
      const L = this.curlVelocity.sample(vL).y;
      const R = this.curlVelocity.sample(vR).y;
      const T = this.curlVelocity.sample(vT).x;
      const B = this.curlVelocity.sample(vB).x;
      const vorticity = R.sub(L).sub(T).add(B);
      this.curlMaterial = make(vec4(vorticity.mul(0.5), 0.0, 0.0, 1.0));
    }

    {
      const { vUv, vL, vR, vT, vB } = neighborUVs();
      const L = this.vortCurl.sample(vL).x;
      const R = this.vortCurl.sample(vR).x;
      const T = this.vortCurl.sample(vT).x;
      const B = this.vortCurl.sample(vB).x;
      const C = this.vortCurl.sample(vUv).x;

      const dir = vec2(abs(T).sub(abs(B)), abs(R).sub(abs(L))).mul(0.5);
      const normalized = dir.div(length(dir).add(0.0001));
      const force = normalized.mul(this.uCurl).mul(C).mul(vec2(1.0, -1.0));

      const velocity = this.vortVelocity.sample(vUv).xy.add(force.mul(this.uVortDt));
      const clamped = clamp(velocity, vec2(-1000.0), vec2(1000.0));
      this.vorticityMaterial = make(vec4(clamped, 0.0, 1.0));
    }

    {
      const { vUv, vL, vR, vT, vB } = neighborUVs();
      const C = this.divVelocity.sample(vUv).xy;
      const L = select(vL.x.lessThan(0.0), C.x.negate(), this.divVelocity.sample(vL).x);
      const R = select(vR.x.greaterThan(1.0), C.x.negate(), this.divVelocity.sample(vR).x);
      const T = select(vT.y.greaterThan(1.0), C.y.negate(), this.divVelocity.sample(vT).y);
      const B = select(vB.y.lessThan(0.0), C.y.negate(), this.divVelocity.sample(vB).y);
      const div = R.sub(L).add(T).sub(B).mul(0.5);
      this.divergenceMaterial = make(vec4(div, 0.0, 0.0, 1.0));
    }

    this.clearMaterial = make(this.clearTexture.mul(this.uClearValue));

    {
      const { vUv, vL, vR, vT, vB } = neighborUVs();
      const L = this.prsPressure.sample(vL).x;
      const R = this.prsPressure.sample(vR).x;
      const T = this.prsPressure.sample(vT).x;
      const B = this.prsPressure.sample(vB).x;
      const divergence = this.prsDivergence.sample(vUv).x;
      const pressure = L.add(R).add(B).add(T).sub(divergence).mul(0.25);
      this.pressureMaterial = make(vec4(pressure, 0.0, 0.0, 1.0));
    }

    {
      const { vUv, vL, vR, vT, vB } = neighborUVs();
      const L = this.gradPressure.sample(vL).x;
      const R = this.gradPressure.sample(vR).x;
      const T = this.gradPressure.sample(vT).x;
      const B = this.gradPressure.sample(vB).x;
      const velocity = this.gradVelocity.sample(vUv).xy.sub(vec2(R.sub(L), T.sub(B)));
      this.gradientSubtractMaterial = make(vec4(velocity, 0.0, 1.0));
    }

    this.materials = [
      this.splatMaterial,
      this.advectionVelocityMaterial,
      this.advectionDyeMaterial,
      this.curlMaterial,
      this.vorticityMaterial,
      this.divergenceMaterial,
      this.clearMaterial,
      this.pressureMaterial,
      this.gradientSubtractMaterial,
    ];
  }

  get dyeTexture(): THREE.Texture | null {
    return this.dye?.read.texture ?? null;
  }

  get aspect(): number {
    return this._aspect;
  }

  private getResolution(base: number): { width: number; height: number } {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    let aspect = size.x / size.y || 1;
    if (aspect < 1) aspect = 1 / aspect;
    const min = Math.round(base);
    const max = Math.round(base * aspect);
    return size.x > size.y ? { width: max, height: min } : { width: min, height: max };
  }

  private makeTarget(
    w: number,
    h: number,
    filter: THREE.MagnificationTextureFilter = THREE.LinearFilter,
  ): THREE.RenderTarget {
    return new THREE.RenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: filter,
      magFilter: filter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  private makeDoubleFBO(
    w: number,
    h: number,
    filter: THREE.MagnificationTextureFilter = THREE.LinearFilter,
  ): DoubleFBO {
    const fbo: DoubleFBO = {
      read: this.makeTarget(w, h, filter),
      write: this.makeTarget(w, h, filter),
      swap() {
        const tmp = this.read;
        this.read = this.write;
        this.write = tmp;
      },
      dispose() {
        this.read.dispose();
        this.write.dispose();
      },
    };
    return fbo;
  }

  buildFramebuffers(simResolution: number, dyeResolution: number): void {
    const simRes = this.getResolution(simResolution);
    const dyeRes = this.getResolution(dyeResolution);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this._aspect = size.x / size.y || 1;
    this.uTexelSize.value.set(1 / simRes.width, 1 / simRes.height);

    this.disposeFramebuffers();
    this.velocity = this.makeDoubleFBO(simRes.width, simRes.height);
    this.dye = this.makeDoubleFBO(dyeRes.width, dyeRes.height);
    this.pressure = this.makeDoubleFBO(simRes.width, simRes.height, THREE.NearestFilter);
    this.divergence = this.makeTarget(simRes.width, simRes.height, THREE.NearestFilter);
    this.curl = this.makeTarget(simRes.width, simRes.height, THREE.NearestFilter);
    this.cleared = false;
  }

  private ensureCleared(): void {
    if (this.cleared) return;
    const velocity = this.velocity;
    const dye = this.dye;
    const pressure = this.pressure;
    const divergence = this.divergence;
    const curl = this.curl;
    if (!velocity || !dye || !pressure || !divergence || !curl) return;

    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    const prevColor = r.getClearColor(
      new THREE.Color() as unknown as Parameters<
        THREE.WebGPURenderer['getClearColor']
      >[0],
    );
    const prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    const targets = [
      velocity.read, velocity.write,
      dye.read, dye.write,
      pressure.read, pressure.write,
      divergence, curl,
    ];
    for (const t of targets) {
      r.setRenderTarget(t);
      r.clear();
    }
    r.setClearColor(prevColor, prevAlpha);
    r.setRenderTarget(prevRT);
    this.cleared = true;
  }

  private blit(material: THREE.MeshBasicNodeMaterial, target: THREE.RenderTarget): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  splat(x: number, y: number, dx: number, dy: number, color: THREE.Color, radius: number): void {
    const velocity = this.velocity;
    const dye = this.dye;
    if (!velocity || !dye) return;

    let r = radius / 100;
    if (this._aspect > 1) r *= this._aspect;

    const prevRT = this.renderer.getRenderTarget();
    this.ensureCleared();

    this.splatTarget.value = velocity.read.texture;
    this.uAspectRatio.value = this._aspect;
    this.uPoint.value.set(x, y);
    this.uColor.value.set(dx, dy, 0);
    this.uRadius.value = r;
    this.blit(this.splatMaterial, velocity.write);
    velocity.swap();

    this.splatTarget.value = dye.read.texture;
    this.uColor.value.set(color.r, color.g, color.b);
    this.blit(this.splatMaterial, dye.write);
    dye.swap();

    this.renderer.setRenderTarget(prevRT);
  }

  step(dt: number, params: FluidStepParams): void {
    const velocity = this.velocity;
    const dye = this.dye;
    const pressure = this.pressure;
    const divergence = this.divergence;
    const curl = this.curl;
    if (!velocity || !dye || !pressure || !divergence || !curl) return;

    const prevRT = this.renderer.getRenderTarget();
    this.ensureCleared();

    this.curlVelocity.value = velocity.read.texture;
    this.blit(this.curlMaterial, curl);

    this.vortVelocity.value = velocity.read.texture;
    this.vortCurl.value = curl.texture;
    this.uCurl.value = params.curl;
    this.uVortDt.value = dt;
    this.blit(this.vorticityMaterial, velocity.write);
    velocity.swap();

    this.divVelocity.value = velocity.read.texture;
    this.blit(this.divergenceMaterial, divergence);

    this.clearTexture.value = pressure.read.texture;
    this.uClearValue.value = params.pressure;
    this.blit(this.clearMaterial, pressure.write);
    pressure.swap();

    this.prsDivergence.value = divergence.texture;
    for (let i = 0; i < params.pressureIterations; i++) {
      this.prsPressure.value = pressure.read.texture;
      this.blit(this.pressureMaterial, pressure.write);
      pressure.swap();
    }

    this.gradPressure.value = pressure.read.texture;
    this.gradVelocity.value = velocity.read.texture;
    this.blit(this.gradientSubtractMaterial, velocity.write);
    velocity.swap();

    this.advVelSelf.value = velocity.read.texture;
    this.uAdvDt.value = dt;
    this.uDissipation.value = params.velocityDissipation;
    this.blit(this.advectionVelocityMaterial, velocity.write);
    velocity.swap();

    this.advDyeVelocity.value = velocity.read.texture;
    this.advDyeSource.value = dye.read.texture;
    this.uDissipation.value = params.densityDissipation;
    this.blit(this.advectionDyeMaterial, dye.write);
    dye.swap();

    this.renderer.setRenderTarget(prevRT);
  }

  private disposeFramebuffers(): void {
    this.velocity?.dispose();
    this.dye?.dispose();
    this.pressure?.dispose();
    this.divergence?.dispose();
    this.curl?.dispose();
    this.velocity = null;
    this.dye = null;
    this.pressure = null;
    this.divergence = null;
    this.curl = null;
  }

  dispose(): void {
    this.disposeFramebuffers();
    for (const mat of this.materials) mat.dispose();
  }
}
