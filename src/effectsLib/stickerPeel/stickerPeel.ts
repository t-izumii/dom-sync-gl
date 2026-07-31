import * as THREE from "three/webgpu";
import type { Node, TextureNode, UniformNode } from "three/webgpu";
import {
  Discard,
  Fn,
  clamp,
  cos,
  float,
  frontFacing,
  length,
  max,
  mix,
  positionGeometry,
  radians,
  select,
  sin,
  smoothstep,
  texture,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { CreatePlaneOptions, DomPlane, PlaneNodeContext } from "../../index";

const TWO_PI = 6.28318530718;

const placeholderTexture = new THREE.DataTexture(
  new Uint8Array([0, 0, 0, 0]),
  1,
  1,
);
placeholderTexture.needsUpdate = true;

const coverSample = (
  tex: TextureNode,
  cuv: Node,
  res: UniformNode<THREE.Vector2>,
): Node => {
  const aspect = res.x.div(max(res.y, 1.0));
  const scale = select(
    aspect.greaterThanEqual(1.0),
    vec2(float(1.0).div(aspect), 1.0),
    vec2(1.0, aspect),
  );
  return tex.sample(cuv.mul(scale).add(0.5)).rgb;
};

export interface StickerPeelOptions {
  progress?: number;
  direction?: number;
  curlRadius?: number;
  thickness?: number;
  color?: THREE.ColorRepresentation;
  backColor?: THREE.ColorRepresentation;
  texture?: THREE.Texture | null;
  backTexture?: THREE.Texture | null;
  segments?: number;
}

export class StickerPeel {
  public segments: number;

  private readonly uProgress: UniformNode<number>;
  private readonly uDirection: UniformNode<number>;
  private readonly uCurlRadius: UniformNode<number>;
  private readonly uThickness: UniformNode<number>;
  private readonly uReady: UniformNode<number>;
  private readonly uUseTexture: UniformNode<number>;
  private readonly uUseBackTexture: UniformNode<number>;
  private readonly uColor: UniformNode<THREE.Color>;
  private readonly uBackColor: UniformNode<THREE.Color>;
  private readonly uImageRes: UniformNode<THREE.Vector2>;
  private readonly uBackImageRes: UniformNode<THREE.Vector2>;
  private readonly tSticker: TextureNode;
  private readonly tStickerBack: TextureNode;

  private curl: { outX: Node; outY: Node; z: Node; vShade: Node } | null = null;

  constructor(options: StickerPeelOptions = {}) {
    this.segments = options.segments ?? 96;
    this.uProgress = uniform(options.progress ?? 1);
    this.uDirection = uniform(options.direction ?? 0);
    this.uCurlRadius = uniform(options.curlRadius ?? 0.12);
    this.uThickness = uniform(options.thickness ?? 0.01);
    this.uReady = uniform(0);
    this.uUseTexture = uniform(0);
    this.uUseBackTexture = uniform(0);
    this.uColor = uniform(new THREE.Color(options.color ?? "#ffffff"));
    this.uBackColor = uniform(new THREE.Color(options.backColor ?? "#f3f0e8"));
    this.uImageRes = uniform(new THREE.Vector2(1, 1));
    this.uBackImageRes = uniform(new THREE.Vector2(1, 1));
    this.tSticker = texture(placeholderTexture);
    this.tStickerBack = texture(placeholderTexture);
    if (options.texture) this.setTexture(options.texture);
    if (options.backTexture) this.setBackTexture(options.backTexture);
  }

  get progress(): number {
    return this.uProgress.value;
  }
  set progress(v: number) {
    this.uProgress.value = v;
  }

  get direction(): number {
    return this.uDirection.value;
  }
  set direction(v: number) {
    this.uDirection.value = v;
  }

  get curlRadius(): number {
    return this.uCurlRadius.value;
  }
  set curlRadius(v: number) {
    this.uCurlRadius.value = v;
  }

  get thickness(): number {
    return this.uThickness.value;
  }
  set thickness(v: number) {
    this.uThickness.value = v;
  }

  setColor(color: THREE.ColorRepresentation): void {
    this.uColor.value.set(color);
  }

  setBackColor(color: THREE.ColorRepresentation): void {
    this.uBackColor.value.set(color);
  }

  setTexture(tex: THREE.Texture | null): void {
    if (!tex) {
      this.tSticker.value = placeholderTexture;
      this.uUseTexture.value = 0;
      this.uReady.value = 0;
      return;
    }
    this.tSticker.value = tex;
    this.uUseTexture.value = 1;
    const image = tex.image as { width?: number; height?: number } | undefined;
    if (image && image.width && image.height) {
      this.uImageRes.value.set(image.width, image.height);
      this.uReady.value = 1;
    } else {
      this.uReady.value = 0;
    }
  }

  setBackTexture(tex: THREE.Texture | null): void {
    if (!tex) {
      this.tStickerBack.value = placeholderTexture;
      this.uUseBackTexture.value = 0;
      return;
    }
    this.tStickerBack.value = tex;
    this.uUseBackTexture.value = 1;
    const image = tex.image as { width?: number; height?: number } | undefined;
    if (image && image.width && image.height) {
      this.uBackImageRes.value.set(image.width, image.height);
    }
  }

  planeOptions(): CreatePlaneOptions {
    return {
      segments: this.segments,
      colorNode: this.colorNode,
      positionNode: this.positionNode,
    };
  }

  applyTo(plane: DomPlane): void {
    plane.material.side = THREE.DoubleSide;
    plane.material.needsUpdate = true;
  }

  private buildCurl(): { outX: Node; outY: Node; z: Node; vShade: Node } {
    if (this.curl) return this.curl;

    const p = positionGeometry;
    const ang = radians(this.uDirection);
    const c = cos(ang);
    const s = sin(ang);

    const qx = c.mul(p.x).add(s.mul(p.y));
    const qy = c.mul(p.y).sub(s.mul(p.x));

    const r = max(this.uCurlRadius, 0.005);
    const xb = mix(float(-0.56), float(0.56), clamp(this.uProgress, 0.0, 1.0));
    const d = qx.sub(xb);

    const rolled = d.greaterThan(0.0);
    const theta = d.div(r);
    const layer = this.uThickness.mul(theta.div(TWO_PI));
    const rEff = r.add(layer);

    const curlA = select(rolled, theta, float(0.0));
    const qxCurl = select(rolled, xb.add(rEff.mul(sin(theta))), qx);
    const z = select(
      rolled,
      rEff.mul(float(1.0).sub(cos(theta))).add(layer),
      float(0.0),
    );

    const outX = c.mul(qxCurl).sub(s.mul(qy));
    const outY = s.mul(qxCurl).add(c.mul(qy));

    const vShade = varying(
      mix(float(1.0), float(0.85), smoothstep(float(1.6), float(3.2), curlA)),
    );

    this.curl = { outX, outY, z, vShade };
    return this.curl;
  }

  readonly positionNode = (ctx: PlaneNodeContext): Node => {
    const { outX, outY, z } = this.buildCurl();
    return vec3(outX, outY, z.mul(ctx.uResolution.x));
  };

  readonly colorNode = (ctx: PlaneNodeContext): Node => {
    const { vShade } = this.buildCurl();
    return Fn(() => {
      const cuv = ctx.uv.sub(0.5);
      const rr = length(cuv);
      Discard(rr.greaterThan(0.5));

      const frontCol = select(
        this.uUseTexture.greaterThan(0.5).and(this.uReady.greaterThan(0.5)),
        coverSample(this.tSticker, cuv, this.uImageRes),
        vec3(this.uColor),
      );
      const backCol = select(
        this.uUseBackTexture.greaterThan(0.5),
        coverSample(
          this.tStickerBack,
          vec2(cuv.x.negate(), cuv.y),
          this.uBackImageRes,
        ),
        vec3(this.uBackColor),
      );

      let col: Node = select(frontFacing, frontCol, backCol);
      col = mix(col, vec3(0.96), smoothstep(float(0.47), float(0.475), rr));
      col = col.mul(vShade);
      return vec4(col, 1.0);
    })();
  };
}
