import * as THREE from "three/webgpu";
import {
  Fn,
  clamp,
  cos,
  distance,
  dot,
  float,
  floor,
  fract,
  length,
  max,
  mix,
  normalize,
  pow,
  select,
  sin,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import type GUI from "lil-gui";
import type { CreatePlaneOptions, PlaneNodeContext } from "../../index";

const placeholderTexture = new THREE.DataTexture(
  new Uint8Array([0, 0, 0, 0]),
  1,
  1,
);
placeholderTexture.needsUpdate = true;

const coverUv = Fn(([uvIn, imageRes, resolution]: [Node, Node, Node]) => {
  const ratio = resolution.div(imageRes);
  const scale = max(ratio.x, ratio.y);
  const scaledSize = imageRes.mul(scale);
  const offset = resolution.sub(scaledSize).mul(0.5);
  return uvIn.mul(resolution).sub(offset).div(scaledSize);
});

const hash21 = Fn(([p]: [Node]) => {
  return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
});

const valueNoise = Fn(([p]: [Node]) => {
  const cell = floor(p);
  const f0 = fract(p);
  const f = f0.mul(f0).mul(float(3.0).sub(f0.mul(2.0)));
  const a = hash21(cell);
  const b = hash21(cell.add(vec2(1.0, 0.0)));
  const c = hash21(cell.add(vec2(0.0, 1.0)));
  const d = hash21(cell.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
});

function imageSizeOf(tex: THREE.Texture): { width: number; height: number } {
  const img = tex.image as
    | {
        width?: number;
        height?: number;
        naturalWidth?: number;
        naturalHeight?: number;
      }
    | undefined;
  return {
    width: img?.naturalWidth || img?.width || 1,
    height: img?.naturalHeight || img?.height || 1,
  };
}

export interface LiquidSwapOptions {
  refraction?: number;
  aberration?: number;
  clarity?: number;
  edgeGlow?: number;
  flow?: number;
  center?: { x: number; y: number };
}

export class LiquidSwap {
  private readonly uTexPrev = texture(placeholderTexture);
  private readonly uTexNext = texture(placeholderTexture);
  private readonly uProgress = uniform(0);
  private readonly uReady = uniform(0);
  private readonly uCenter = uniform(new THREE.Vector2(0.5, 0.5));
  private readonly uImageResPrev = uniform(new THREE.Vector2(1, 1));
  private readonly uImageResNext = uniform(new THREE.Vector2(1, 1));
  private readonly uRefraction = uniform(1);
  private readonly uAberration = uniform(1);
  private readonly uClarity = uniform(1);
  private readonly uEdgeGlow = uniform(1);
  private readonly uFlow = uniform(1);

  private hasPrev = false;
  private hasNext = false;

  constructor(options: LiquidSwapOptions = {}) {
    this.uRefraction.value = options.refraction ?? 1;
    this.uAberration.value = options.aberration ?? 1;
    this.uClarity.value = options.clarity ?? 1;
    this.uEdgeGlow.value = options.edgeGlow ?? 1;
    this.uFlow.value = options.flow ?? 1;
    if (options.center) {
      this.uCenter.value.set(options.center.x, options.center.y);
    }
  }

  planeOptions(): CreatePlaneOptions {
    return {
      colorNode: this.colorNode,
      setupGUI: this.setupGUI,
    };
  }

  readonly setupGUI = (gui: GUI): GUI => {
    const folder = gui.addFolder('液体スワップ (Liquid swap)');
    folder.add(this, 'progress', 0, 1, 0.001).name('遷移進行度');
    folder.add(this, 'refraction', 0, 3, 0.01).name('屈折の強さ');
    folder.add(this, 'aberration', 0, 3, 0.01).name('色収差の強さ');
    /* 上限 3 は clearZone (= clarity * 0.3) を 1.0 未満に保つため。
     * 1.0 に達すると smoothstep の上下端が重なりクリア領域が
     * 円全体に広がって効果が消える */
    folder.add(this, 'clarity', 0, 3, 0.01).name('中心クリア領域の広さ');
    folder.add(this, 'edgeGlow', 0, 3, 0.01).name('縁のグロー');
    folder.add(this, 'flow', 0, 3, 0.01).name('流れの強さ');
    return folder;
  };

  readonly colorNode = (ctx: PlaneNodeContext): Node => {
    const uv = vec2(ctx.uv);
    const resolution = vec2(ctx.uResolution);

    const t = clamp(this.uProgress, 0.0, 1.0);
    const uvPrev = coverUv(uv, vec2(this.uImageResPrev), resolution);
    const prevColor = this.uTexPrev.sample(uvPrev);
    const uvNext = coverUv(uv, vec2(this.uImageResNext), resolution);

    const pixel = uv.mul(resolution);
    const center = vec2(this.uCenter).mul(resolution);
    const maxDist = length(max(center, resolution.sub(center)));
    const radius = t.mul(maxDist);
    const dist = distance(pixel, center);
    const mask = smoothstep(radius.add(3.0), radius.sub(3.0), dist);
    const norm = dist.div(max(radius, 0.001));
    const dir = select(
      dist.greaterThan(0.0001),
      pixel.sub(center).div(max(dist, 0.0001)),
      vec2(0.0),
    );

    const clearZone = this.uClarity.mul(0.3);
    const distFactor = smoothstep(clearZone, 1.0, norm);
    const phase = t.mul(5.0);

    const fadeOut = float(1.0).sub(smoothstep(0.8, 1.0, t));
    const rimStrength = this.uEdgeGlow.mul(0.08).mul(fadeOut);
    const borderStrength = this.uEdgeGlow.mul(0.06).mul(fadeOut);

    const bendDir = normalize(
      dir.add(vec2(sin(phase), cos(phase.mul(0.7))).mul(0.3)),
    );
    const bent = uvNext.sub(
      bendDir.mul(this.uRefraction.mul(0.08)).mul(pow(distFactor, 1.5)),
    );

    const ripple = sin(norm.mul(22.0).sub(phase.mul(3.5)))
      .add(sin(norm.mul(35.0).add(phase.mul(2.8))).mul(0.7))
      .add(sin(norm.mul(50.0).sub(phase.mul(4.2))).mul(0.5))
      .div(3.0);
    const rippled = bent.sub(dir.mul(ripple.mul(0.025).mul(distFactor)));

    const surface = vec2(
      valueNoise(uv.mul(100.0).add(phase.mul(0.3))),
      valueNoise(uv.mul(100.0).add(phase.mul(0.2).add(50.0))),
    ).sub(0.5);
    const sampleUv = rippled
      .sub(surface.mul(distFactor.mul(0.004)))
      .add(
        vec2(
          sin(phase.add(norm.mul(10.0))),
          cos(phase.mul(0.8).add(norm.mul(8.0))),
        )
          .mul(this.uFlow.mul(0.015))
          .mul(distFactor)
          .mul(mask),
      );

    const aberration = this.uAberration.mul(0.02).mul(pow(distFactor, 1.2));
    const r = this.uTexNext.sample(sampleUv.add(dir.mul(aberration).mul(1.2))).r;
    const g = this.uTexNext.sample(sampleUv.add(dir.mul(aberration).mul(0.2))).g;
    const b = this.uTexNext.sample(sampleUv.sub(dir.mul(aberration).mul(0.8))).b;

    const insideEdge = float(1.0).sub(smoothstep(1.0, 1.01, norm));
    const rim = smoothstep(0.95, 1.0, norm).mul(insideEdge);
    const border = smoothstep(0.975, 1.0, norm).mul(insideEdge);
    const distortedRgb = mix(
      vec3(r, g, b).add(rim.mul(rimStrength)),
      vec3(1.0),
      border.mul(borderStrength),
    );

    const cleanNext = this.uTexNext.sample(uvNext);
    const revealedRaw = select(
      mask.greaterThan(0.0),
      vec4(distortedRgb, 1.0),
      cleanNext,
    );

    const revealed = mix(
      revealedRaw,
      cleanNext,
      clamp(t.sub(0.95).div(0.05), 0.0, 1.0),
    );

    const composed = mix(prevColor, revealed, mask);
    const active = select(t.lessThanEqual(0.0), prevColor, composed);
    return select(this.uReady.lessThan(0.5), vec4(0.0), active);
  };

  setTextures(prev: THREE.Texture, next: THREE.Texture): void {
    this.setPrevTexture(prev);
    this.setNextTexture(next);
  }

  setPrevTexture(tex: THREE.Texture): void {
    this.uTexPrev.value = tex;
    const { width, height } = imageSizeOf(tex);
    this.uImageResPrev.value.set(width, height);
    this.hasPrev = true;
    this.updateReady();
  }

  setNextTexture(tex: THREE.Texture): void {
    this.uTexNext.value = tex;
    const { width, height } = imageSizeOf(tex);
    this.uImageResNext.value.set(width, height);
    this.hasNext = true;
    this.updateReady();
  }

  commit(): void {
    this.uTexPrev.value = this.uTexNext.value;
    this.uImageResPrev.value.copy(this.uImageResNext.value);
    this.hasPrev = this.hasNext;
    this.uProgress.value = 0;
  }

  get progress(): number {
    return this.uProgress.value;
  }
  set progress(v: number) {
    this.uProgress.value = v;
  }

  setCenter(x: number, y: number): void {
    this.uCenter.value.set(x, y);
  }

  get refraction(): number {
    return this.uRefraction.value;
  }
  set refraction(v: number) {
    this.uRefraction.value = v;
  }

  get aberration(): number {
    return this.uAberration.value;
  }
  set aberration(v: number) {
    this.uAberration.value = v;
  }

  get clarity(): number {
    return this.uClarity.value;
  }
  set clarity(v: number) {
    this.uClarity.value = v;
  }

  get edgeGlow(): number {
    return this.uEdgeGlow.value;
  }
  set edgeGlow(v: number) {
    this.uEdgeGlow.value = v;
  }

  get flow(): number {
    return this.uFlow.value;
  }
  set flow(v: number) {
    this.uFlow.value = v;
  }

  get ready(): boolean {
    return this.hasPrev && this.hasNext;
  }

  private updateReady(): void {
    this.uReady.value = this.ready ? 1 : 0;
  }
}

const sharedLoader = new THREE.TextureLoader();
sharedLoader.setCrossOrigin("anonymous");

export function loadLiquidSwapTexture(
  url: string,
  colorSpace: THREE.ColorSpace = THREE.SRGBColorSpace,
): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    sharedLoader.load(
      url,
      (tex) => {
        tex.colorSpace = colorSpace;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}
