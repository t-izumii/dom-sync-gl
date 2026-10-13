/**
 * ポインタでかき混ぜる Navier–Stokes 流体と、その密度から導いた法線。
 *
 * 移植元は re3 の `FluidSimulation`（main.beautified.js 37594-37663）。
 * 一般的な実装（splashCursor など）と違う点がそのまま見た目を決めるので、
 * パスの順序・反復回数・散逸率は変えない。
 *
 * - 圧力ヤコビ反復は 2 回だけ。前フレームの圧力を 0.99 倍して持ち越し、
 *   収束の不足を補っている
 * - 1 フレームは「力 → 渦度 → 射影 → 移流」の順で閉じる
 * - 散逸はフレームごとの乗算（dt に比例しない）
 * - 密度・法線は速度場の 2 倍の解像度で持つが、近傍を取る texelSize は
 *   速度場のものを全パスで共有する（法線は 2 密度テクセル離れた差分になる）
 *
 * 座標は uv() の左上原点で解く。原典は左下原点だが、流体の式は上下反転に
 * 対して対称なので、ポインタも同じ向きで渡せば画面上の結果は一致する。
 * 例外は法線で、画面上の「下」の画素との差を取る式なので、下の画素を
 * 明示して原典と同じ値にしている。
 */
import * as THREE from 'three/webgpu';
import {
  abs,
  clamp,
  cross,
  dot,
  exp,
  length,
  max,
  normalize,
  select,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

/** 密度・法線を速度場の何倍の解像度で持つか */
const DYE_SCALE = 2;

export interface WaterFluidStepParams {
  curl: number;
  pressureIterations: number;
  velocityDissipation: number;
  densityDissipation: number;
  pressureDecay: number;
  normalEpsilon: number;
}

interface DoubleFBO {
  read: THREE.RenderTarget;
  write: THREE.RenderTarget;
  swap(): void;
  dispose(): void;
}

export class WaterFluidSim {
  private readonly renderer: THREE.WebGPURenderer;
  private readonly quad = new THREE.QuadMesh();

  private readonly uTexelSize = uniform(new THREE.Vector2(1, 1));
  private readonly uAspect = uniform(1);
  private readonly uDt = uniform(0);

  private readonly splatBase = texture();
  private readonly uPoint = uniform(new THREE.Vector2());
  private readonly uPrevPoint = uniform(new THREE.Vector2());
  private readonly uColor = uniform(new THREE.Vector3());
  private readonly uRadius = uniform(0.0015);

  private readonly curlVelocity = texture();
  private readonly vortVelocity = texture();
  private readonly vortCurl = texture();
  private readonly uCurl = uniform(10);
  private readonly divVelocity = texture();
  private readonly clearPressure = texture();
  private readonly uPressureDecay = uniform(0.99);
  private readonly prsPressure = texture();
  private readonly prsDivergence = texture();
  private readonly gradPressure = texture();
  private readonly gradVelocity = texture();
  private readonly advSelf = texture();
  private readonly uVelocityDissipation = uniform(0.99);
  private readonly advDyeVelocity = texture();
  private readonly advDyeSource = texture();
  private readonly uDensityDissipation = uniform(0.97);
  private readonly nrmDensity = texture();
  private readonly uNormalEpsilon = uniform(0.1);
  private readonly dltNormal = texture();

  private readonly splatMaterial: THREE.MeshBasicNodeMaterial;
  private readonly curlMaterial: THREE.MeshBasicNodeMaterial;
  private readonly vorticityMaterial: THREE.MeshBasicNodeMaterial;
  private readonly divergenceMaterial: THREE.MeshBasicNodeMaterial;
  private readonly clearMaterial: THREE.MeshBasicNodeMaterial;
  private readonly pressureMaterial: THREE.MeshBasicNodeMaterial;
  private readonly gradientSubtractMaterial: THREE.MeshBasicNodeMaterial;
  private readonly advectionVelocityMaterial: THREE.MeshBasicNodeMaterial;
  private readonly advectionDensityMaterial: THREE.MeshBasicNodeMaterial;
  private readonly normalMaterial: THREE.MeshBasicNodeMaterial;
  private readonly normalDeltaMaterial: THREE.MeshBasicNodeMaterial;
  private readonly materials: THREE.MeshBasicNodeMaterial[];

  private velocity: DoubleFBO | null = null;
  private density: DoubleFBO | null = null;
  private pressure: DoubleFBO | null = null;
  private divergence: THREE.RenderTarget | null = null;
  private curl: THREE.RenderTarget | null = null;
  private normal: THREE.RenderTarget | null = null;
  private normalDelta: THREE.RenderTarget | null = null;
  private cleared = false;

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
    const neighbors = () => {
      const vUv = uv();
      return {
        vUv,
        vL: vUv.sub(vec2(texel.x, 0)),
        vR: vUv.add(vec2(texel.x, 0)),
        vT: vUv.add(vec2(0, texel.y)),
        vB: vUv.sub(vec2(0, texel.y)),
      };
    };

    // 前フレーム位置から現在位置への線分にガウス分布を載せる
    {
      const aspect = vec2(this.uAspect, 1);
      const p = this.uPoint.mul(aspect);
      const pp = this.uPrevPoint.mul(aspect);
      const q0 = uv().mul(aspect);
      const dP = p.sub(pp);
      const ldP = length(dP);
      const ndP = dP.div(max(ldP, 1e-6));
      const q = q0.sub(pp.add(ndP.mul(clamp(dot(ndP, q0.sub(pp)), 0, ldP))));
      const splat = exp(dot(q, q).negate().div(this.uRadius)).mul(this.uColor);
      const added = select(ldP.lessThan(1e-4), vec3(0), splat);
      this.splatMaterial = make(vec4(this.splatBase.xyz.add(added), 1));
    }

    {
      const { vL, vR, vT, vB } = neighbors();
      const L = this.curlVelocity.sample(vL).y;
      const R = this.curlVelocity.sample(vR).y;
      const T = this.curlVelocity.sample(vT).x;
      const B = this.curlVelocity.sample(vB).x;
      this.curlMaterial = make(vec4(R.sub(L).sub(T).add(B).mul(0.5), 0, 0, 1));
    }

    {
      const { vUv, vL, vR, vT, vB } = neighbors();
      const L = this.vortCurl.sample(vL).x;
      const R = this.vortCurl.sample(vR).x;
      const T = this.vortCurl.sample(vT).x;
      const B = this.vortCurl.sample(vB).x;
      const C = this.vortCurl.sample(vUv).x;
      const dir = vec2(abs(T).sub(abs(B)), abs(R).sub(abs(L))).mul(0.5);
      const force = dir
        .div(length(dir).add(0.0001))
        .mul(this.uCurl)
        .mul(C)
        .mul(vec2(1, -1));
      const velocity = this.vortVelocity.sample(vUv).xy.add(force.mul(this.uDt));
      this.vorticityMaterial = make(vec4(velocity, 0, 1));
    }

    {
      const { vUv, vL, vR, vT, vB } = neighbors();
      const C = this.divVelocity.sample(vUv).xy;
      const L = select(vL.x.lessThan(0), C.x.negate(), this.divVelocity.sample(vL).x);
      const R = select(vR.x.greaterThan(1), C.x.negate(), this.divVelocity.sample(vR).x);
      const T = select(vT.y.greaterThan(1), C.y.negate(), this.divVelocity.sample(vT).y);
      const B = select(vB.y.lessThan(0), C.y.negate(), this.divVelocity.sample(vB).y);
      this.divergenceMaterial = make(vec4(R.sub(L).add(T).sub(B).mul(0.5), 0, 0, 1));
    }

    // 0 埋めではなく前フレームの圧力を減衰させて残す（反復 2 回の収束不足を補う）
    this.clearMaterial = make(vec4(this.clearPressure.rgb.mul(this.uPressureDecay), 1));

    {
      const { vUv, vL, vR, vT, vB } = neighbors();
      const L = this.prsPressure.sample(vL).x;
      const R = this.prsPressure.sample(vR).x;
      const T = this.prsPressure.sample(vT).x;
      const B = this.prsPressure.sample(vB).x;
      const divergence = this.prsDivergence.sample(vUv).x;
      this.pressureMaterial = make(vec4(L.add(R).add(B).add(T).sub(divergence).mul(0.25), 0, 0, 1));
    }

    {
      const { vUv, vL, vR, vT, vB } = neighbors();
      const L = this.gradPressure.sample(vL).x;
      const R = this.gradPressure.sample(vR).x;
      const T = this.gradPressure.sample(vT).x;
      const B = this.gradPressure.sample(vB).x;
      const velocity = this.gradVelocity.sample(vUv).xy.sub(vec2(R.sub(L), T.sub(B)));
      this.gradientSubtractMaterial = make(vec4(velocity, 0, 1));
    }

    // 速度と密度で material を分ける。1 つの material で texture の value を
    // 差し替えて使い回すと、最初の描画で 2 つの texture が同じ速度場を指して
    // いたため、密度の移流に速度場が渡らなくなる（密度がまったく流れない）
    {
      const coord = uv().sub(this.advSelf.xy.mul(this.uDt).mul(texel));
      this.advectionVelocityMaterial = make(
        vec4(this.advSelf.sample(coord).rgb.mul(this.uVelocityDissipation), 1),
      );
    }
    {
      const coord = uv().sub(this.advDyeVelocity.xy.mul(this.uDt).mul(texel));
      this.advectionDensityMaterial = make(
        vec4(this.advDyeSource.sample(coord).rgb.mul(this.uDensityDissipation), 1),
      );
    }

    // 原典（左下原点）の vB は画面上の下の画素。左上原点では +y 側になる
    const screenBelow = () => uv().add(vec2(0, texel.y));

    {
      const { vUv, vR } = neighbors();
      const C = length(this.nrmDensity.sample(vUv).xy);
      const R = length(this.nrmDensity.sample(vR).xy);
      const B = length(this.nrmDensity.sample(screenBelow()).xy);
      const up = vec3(0, 1, 0);
      const eps = this.uNormalEpsilon;
      const tangentX = up.mul(R.sub(C)).add(vec3(eps, 0, 0));
      const tangentZ = up.mul(B.sub(C)).add(vec3(0, 0, eps));
      this.normalMaterial = make(vec4(normalize(up.add(cross(tangentX, tangentZ))), 1));
    }

    {
      const { vUv, vR } = neighbors();
      const C = this.dltNormal.sample(vUv).xyz;
      const R = this.dltNormal.sample(vR).xyz;
      const B = this.dltNormal.sample(screenBelow()).xyz;
      this.normalDeltaMaterial = make(vec4(abs(R.sub(C)).add(abs(B.sub(C))), 1));
    }

    this.materials = [
      this.splatMaterial,
      this.curlMaterial,
      this.vorticityMaterial,
      this.divergenceMaterial,
      this.clearMaterial,
      this.pressureMaterial,
      this.gradientSubtractMaterial,
      this.advectionVelocityMaterial,
      this.advectionDensityMaterial,
      this.normalMaterial,
      this.normalDeltaMaterial,
    ];
  }

  /** 法線（xyz）。画面全体に 1 枚で対応する */
  get normalTexture(): THREE.Texture | null {
    return this.normal?.texture ?? null;
  }

  /** 法線の変化量（xyz）。発光に使う */
  get normalDeltaTexture(): THREE.Texture | null {
    return this.normalDelta?.texture ?? null;
  }

  private makeTarget(w: number, h: number, filter: THREE.MagnificationTextureFilter): THREE.RenderTarget {
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

  private makeDoubleFBO(w: number, h: number, filter: THREE.MagnificationTextureFilter): DoubleFBO {
    return {
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
  }

  /**
   * 画面のアスペクト比を保ったまま、総画素数が pixelBudget に収まる解像度で
   * バッファを用意する。解像度が変わらないときは作り直さない（流体が消えるため）。
   */
  buildFramebuffers(viewportWidth: number, viewportHeight: number, pixelBudget: number): void {
    const scale = Math.sqrt(pixelBudget / Math.max(1, viewportWidth * viewportHeight));
    const w = Math.max(1, Math.floor(scale * viewportWidth));
    const h = Math.max(1, Math.floor(scale * viewportHeight));
    this.uTexelSize.value.set(1 / w, 1 / h);
    this.uAspect.value = w / h;

    if (this.velocity && this.velocity.read.width === w && this.velocity.read.height === h) return;

    this.disposeFramebuffers();
    const dw = w * DYE_SCALE;
    const dh = h * DYE_SCALE;
    this.velocity = this.makeDoubleFBO(w, h, THREE.LinearFilter);
    this.density = this.makeDoubleFBO(dw, dh, THREE.LinearFilter);
    this.pressure = this.makeDoubleFBO(w, h, THREE.NearestFilter);
    this.divergence = this.makeTarget(w, h, THREE.NearestFilter);
    this.curl = this.makeTarget(w, h, THREE.NearestFilter);
    this.normal = this.makeTarget(dw, dh, THREE.NearestFilter);
    this.normalDelta = this.makeTarget(dw, dh, THREE.LinearFilter);
    this.cleared = false;
  }

  private ensureCleared(): void {
    if (this.cleared) return;
    const r = this.renderer;
    const prevColor = r.getClearColor(
      new THREE.Color() as unknown as Parameters<THREE.WebGPURenderer['getClearColor']>[0],
    );
    const prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    for (const fbo of [this.velocity, this.density, this.pressure]) {
      if (!fbo) continue;
      for (const t of [fbo.read, fbo.write]) {
        r.setRenderTarget(t);
        r.clear();
      }
    }
    for (const t of [this.divergence, this.curl, this.normal, this.normalDelta]) {
      if (!t) continue;
      r.setRenderTarget(t);
      r.clear();
    }
    r.setClearColor(prevColor, prevAlpha);
    this.cleared = true;
  }

  private blit(material: THREE.MeshBasicNodeMaterial, target: THREE.RenderTarget): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  private blitSwap(material: THREE.MeshBasicNodeMaterial, fbo: DoubleFBO): void {
    this.blit(material, fbo.write);
    fbo.swap();
  }

  /**
   * 1 フレーム進める。
   *
   * @param dt 経過秒。移流と渦度の力にだけ掛かる
   * @param pointer 前フレーム位置 → 現在位置（UV・左上原点）と、速度・密度に足す値。
   *   動いていないフレームは null
   */
  step(
    dt: number,
    params: WaterFluidStepParams,
    pointer: { x: number; y: number; prevX: number; prevY: number; force: number; radius: number } | null,
  ): void {
    const { velocity, density, pressure, divergence, curl, normal, normalDelta } = this;
    if (!velocity || !density || !pressure || !divergence || !curl || !normal || !normalDelta) return;

    const prevRT = this.renderer.getRenderTarget();
    this.ensureCleared();
    this.uDt.value = dt;

    if (pointer) {
      this.uPoint.value.set(pointer.x, pointer.y);
      this.uPrevPoint.value.set(pointer.prevX, pointer.prevY);
      this.uRadius.value = pointer.radius;
      // 速度と密度に同じ値を足す。密度は xy の大きさが高さとして法線になる
      this.uColor.value.set(
        (pointer.x - pointer.prevX) * pointer.force,
        (pointer.y - pointer.prevY) * pointer.force,
        1,
      );
      this.splatBase.value = velocity.read.texture;
      this.blitSwap(this.splatMaterial, velocity);
      this.splatBase.value = density.read.texture;
      this.blitSwap(this.splatMaterial, density);
    }

    this.curlVelocity.value = velocity.read.texture;
    this.blit(this.curlMaterial, curl);

    this.vortVelocity.value = velocity.read.texture;
    this.vortCurl.value = curl.texture;
    this.uCurl.value = params.curl;
    this.blitSwap(this.vorticityMaterial, velocity);

    this.divVelocity.value = velocity.read.texture;
    this.blit(this.divergenceMaterial, divergence);

    this.clearPressure.value = pressure.read.texture;
    this.uPressureDecay.value = params.pressureDecay;
    this.blitSwap(this.clearMaterial, pressure);

    this.prsDivergence.value = divergence.texture;
    for (let i = 0; i < params.pressureIterations; i++) {
      this.prsPressure.value = pressure.read.texture;
      this.blitSwap(this.pressureMaterial, pressure);
    }

    this.gradPressure.value = pressure.read.texture;
    this.gradVelocity.value = velocity.read.texture;
    this.blitSwap(this.gradientSubtractMaterial, velocity);

    this.advSelf.value = velocity.read.texture;
    this.uVelocityDissipation.value = params.velocityDissipation;
    this.blitSwap(this.advectionVelocityMaterial, velocity);

    this.advDyeVelocity.value = velocity.read.texture;
    this.advDyeSource.value = density.read.texture;
    this.uDensityDissipation.value = params.densityDissipation;
    this.blitSwap(this.advectionDensityMaterial, density);

    this.nrmDensity.value = density.read.texture;
    this.uNormalEpsilon.value = params.normalEpsilon;
    this.blit(this.normalMaterial, normal);

    this.dltNormal.value = normal.texture;
    this.blit(this.normalDeltaMaterial, normalDelta);

    this.renderer.setRenderTarget(prevRT);
  }

  private disposeFramebuffers(): void {
    this.velocity?.dispose();
    this.density?.dispose();
    this.pressure?.dispose();
    this.divergence?.dispose();
    this.curl?.dispose();
    this.normal?.dispose();
    this.normalDelta?.dispose();
    this.velocity = null;
    this.density = null;
    this.pressure = null;
    this.divergence = null;
    this.curl = null;
    this.normal = null;
    this.normalDelta = null;
  }

  dispose(): void {
    this.disposeFramebuffers();
    for (const material of this.materials) material.dispose();
  }
}
