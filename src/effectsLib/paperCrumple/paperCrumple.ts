/**
 * 押している間だけ plane が紙のようにくしゃくしゃに丸まり、離すと広がって戻る
 * エフェクト。丸まった紙は床（ページ）に影を落とす。
 *
 * 発想は React Bits の Paper Crumple から借りているが、コードは独自。
 * 潰れていく過程は `bakeCrumple()` で一度だけ解いておき、毎フレームは進行度に
 * 応じてコマを補間した頂点を plane の geometry に直接書く。頂点を CPU で
 * 動かすので、影の深度パスにも同じ形がそのまま使われる。
 *
 * 影は、明るさに寄与しない（intensity 0）専用の DirectionalLight と、
 * plane の背後に置いた ShadowNodeMaterial の受け皿で落とす。そのため
 * `applyTo()` で renderer の shadowMap を有効にする。
 *
 * @see ./crumpleBake.ts
 */
import * as THREE from "three/webgpu";
import type { Node, UniformNode } from "three/webgpu";
import {
  Fn,
  cameraPosition,
  dot,
  float,
  fract,
  frontFacing,
  max,
  mix,
  normalGeometry,
  normalize,
  positionWorld,
  select,
  sin,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type GUI from "lil-gui";
import type { CreatePlaneOptions, DomPlane, DomSyncGL, PlaneNodeContext } from "../../index";
import { bakeCrumple, computeNormals, type CrumpleBake } from "./crumpleBake";

export interface PaperCrumpleOptions {
  /** 格子の分割数。多いほど折り目が細かいが、事前計算が重くなる */
  segments?: number;
  /** 折り線の本数 */
  foldCount?: number;
  /** 丸め終えた球の半径（紙の幅に対する比） */
  ballRadius?: number;
  seed?: number;
  /** 丸めきるまでの時間（秒） */
  crumpleDuration?: number;
  /** 広がって戻るまでの時間（秒） */
  releaseDuration?: number;
  /** 押している間に持ち上げる高さ（紙の幅に対する比）。影が離れて浮いて見える */
  lift?: number;
  /** 離したあとに残る皺の強さ（0 で完全に平らに戻る） */
  creaseMemory?: number;
  /** 光の来る向き（ページ手前が +z）。影はこの逆側へ落ちる */
  lightDirection?: THREE.Vector3Like;
  /** 影の濃さ（0〜1） */
  shadowOpacity?: number;
  /** 影の縁のぼかし（PCF の半径） */
  shadowRadius?: number;
  /** 紙の裏面の色 */
  backColor?: THREE.ColorRepresentation;
}

/** 皺を残すときに使うコマ（全体に対する位置）。浅く皺が入った段階 */
const CREASE_FRAME = 0.3;

export class PaperCrumple {
  public readonly segments: number;
  public foldCount: number;
  public ballRadius: number;
  public seed: number;
  public crumpleDuration: number;
  public releaseDuration: number;
  public lift: number;
  public creaseMemory: number;

  private readonly uLighting: UniformNode<number>;
  private readonly uLightDir: UniformNode<THREE.Vector3>;
  private readonly uBackColor: UniformNode<THREE.Color>;

  private plane: DomPlane | null = null;
  private light: THREE.DirectionalLight | null = null;
  private floor: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowNodeMaterial> | null = null;
  private bake: CrumpleBake | null = null;
  private normals: Float32Array | null = null;
  private sim: Float32Array | null = null;
  private removeUpdate: (() => void) | null = null;
  private readonly listeners = new AbortController();
  private readonly reducedMotion: MediaQueryList | null =
    typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

  private _shadowOpacity: number;
  private _shadowRadius: number;
  private target = 0;
  private _progress = 0;
  private hold = 0;
  private peak = 0;
  private lastTime = -1;
  private dirty = true;
  private written = { w: 0, h: 0 };

  constructor(options: PaperCrumpleOptions = {}) {
    this.segments = options.segments ?? 40;
    this.foldCount = options.foldCount ?? 7;
    this.ballRadius = options.ballRadius ?? 0.17;
    this.seed = options.seed ?? 1;
    this.crumpleDuration = options.crumpleDuration ?? 0.9;
    this.releaseDuration = options.releaseDuration ?? 0.7;
    this.lift = options.lift ?? 0.06;
    this.creaseMemory = options.creaseMemory ?? 0.15;
    this._shadowOpacity = options.shadowOpacity ?? 0.35;
    this._shadowRadius = options.shadowRadius ?? 6;
    const dir = options.lightDirection ?? { x: -0.35, y: 0.5, z: 1 };
    this.uLightDir = uniform(new THREE.Vector3(dir.x, dir.y, dir.z).normalize());
    this.uLighting = uniform(0);
    this.uBackColor = uniform(new THREE.Color(options.backColor ?? "#f2efe8"));
  }

  /** 丸まり具合（0 = 平ら、1 = 丸めきった状態） */
  get progress(): number {
    return this._progress;
  }
  set progress(v: number) {
    this._progress = Math.min(1, Math.max(0, v));
    this.target = this._progress;
    this.dirty = true;
  }

  get shadowOpacity(): number {
    return this._shadowOpacity;
  }
  set shadowOpacity(v: number) {
    this._shadowOpacity = v;
    if (this.floor) this.floor.material.opacity = v;
  }

  get shadowRadius(): number {
    return this._shadowRadius;
  }
  set shadowRadius(v: number) {
    this._shadowRadius = v;
    if (this.light) this.light.shadow.radius = v;
  }

  setLightDirection(dir: THREE.Vector3Like): void {
    this.uLightDir.value.set(dir.x, dir.y, dir.z).normalize();
  }

  /** 丸め始める（押したときと同じ） */
  press(): void {
    this.target = 1;
  }

  /** 広げて戻す（離したときと同じ） */
  release(): void {
    this.target = 0;
  }

  /** 残った皺も含めて平らな状態に戻す */
  reset(): void {
    this.target = 0;
    this._progress = 0;
    this.hold = 0;
    this.peak = 0;
    this.dirty = true;
  }

  planeOptions(): CreatePlaneOptions {
    return {
      segments: this.segments,
      colorNode: this.colorNode,
      setupGUI: this.setupGUI,
    };
  }

  readonly setupGUI = (gui: GUI): GUI => {
    const folder = gui.addFolder("紙くしゃ (Paper crumple)");
    folder.add(this, "progress", 0, 1, 0.001).name("丸まり具合").listen();
    folder.add(this, "crumpleDuration", 0.1, 3, 0.05).name("丸める時間（秒）");
    folder.add(this, "releaseDuration", 0.1, 3, 0.05).name("戻る時間（秒）");
    folder.add(this, "lift", 0, 0.3, 0.005).name("持ち上げる高さ");
    folder.add(this, "creaseMemory", 0, 1, 0.01).name("残る皺の強さ");
    folder.add(this, "shadowOpacity", 0, 1, 0.01).name("影の濃さ");
    folder.add(this, "shadowRadius", 0, 20, 0.5).name("影のぼかし");
    folder.add(this, "reset").name("平らに戻す");
    return folder;
  };

  /**
   * plane に紙の形と影を組み込み、押す操作を plane の DOM 要素につなぐ。
   * plane は `planeOptions()` で作ったものを渡す。
   */
  applyTo(plane: DomPlane, app: DomSyncGL): void {
    if (this.plane) throw new Error("[PaperCrumple] applyTo() can only be called once.");
    this.plane = plane;

    const renderer = app.getRenderer();
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    plane.material.side = THREE.DoubleSide;
    plane.material.needsUpdate = true;
    plane.mesh.castShadow = true;
    // 丸めると頂点が元の板の外へ出るため、板の境界での判定を止める
    plane.mesh.frustumCulled = false;

    // 影だけを落とす光。intensity 0 なので他の物体の明るさは変えない
    const light = new THREE.DirectionalLight(0xffffff, 0);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.radius = this._shadowRadius;
    light.shadow.bias = -0.0005;
    plane.scene.add(light, light.target);
    this.light = light;

    // 影の受け皿。plane の子にして位置・px 単位の拡大・表示状態を引き継ぐ
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowNodeMaterial({ transparent: true, depthWrite: false }),
    );
    floor.material.opacity = this._shadowOpacity;
    floor.receiveShadow = true;
    floor.scale.set(2.5, 2.5, 1);
    floor.position.z = -1;
    floor.raycast = () => {};
    plane.mesh.add(floor);
    this.floor = floor;

    const el = plane.element;
    if (el) {
      const signal = this.listeners.signal;
      el.addEventListener(
        "pointerdown",
        (e) => {
          if (e.button !== 0) return;
          el.setPointerCapture(e.pointerId);
          this.press();
        },
        { signal },
      );
      const up = () => this.release();
      el.addEventListener("pointerup", up, { signal });
      el.addEventListener("pointercancel", up, { signal });
      el.addEventListener("lostpointercapture", up, { signal });
    }

    this.removeUpdate = app.addUpdateCallback(this.update);
  }

  dispose(): void {
    this.removeUpdate?.();
    this.removeUpdate = null;
    this.listeners.abort();
    if (this.light) {
      this.light.removeFromParent();
      this.light.target.removeFromParent();
      this.light.shadow.dispose();
      this.light.dispose();
      this.light = null;
    }
    if (this.floor) {
      this.floor.removeFromParent();
      this.floor.geometry.dispose();
      this.floor.material.dispose();
      this.floor = null;
    }
    this.plane = null;
    this.bake = null;
  }

  private readonly update = (): void => {
    const plane = this.plane;
    if (!plane) return;
    // plane が destroy されたら（scene から外れたら）道連れで片付ける
    if (!plane.mesh.parent) {
      this.dispose();
      return;
    }

    const now = performance.now() / 1000;
    const dt = this.lastTime < 0 ? 0 : Math.min(now - this.lastTime, 0.1);
    this.lastTime = now;

    const w = plane.mesh.scale.x;
    const h = plane.mesh.scale.y;
    if (w <= 0 || h <= 0) return;
    this.ensureBake(h / w);

    this.step(dt);
    this.updateLight(w, h);
    if (this.dirty || w !== this.written.w || h !== this.written.h) {
      this.writeGeometry(w, h);
    }
  };

  /** 進行度と持ち上げ量を、目標へ指数的に近づける */
  private step(dt: number): void {
    const prevProgress = this._progress;
    const prevHold = this.hold;
    const holding = this.target > 0.5 ? 1 : 0;
    if (this.reducedMotion?.matches) {
      this._progress = this.target;
      this.hold = holding;
    } else {
      const dur = this.target > this._progress ? this.crumpleDuration : this.releaseDuration;
      // 時間 dur でほぼ（約 98%）到達する速さ
      const k = 1 - Math.exp((-4 * dt) / Math.max(dur, 1e-3));
      this._progress += (this.target - this._progress) * k;
      this.hold += (holding - this.hold) * k;
      if (Math.abs(this.target - this._progress) < 1e-4) this._progress = this.target;
      if (Math.abs(holding - this.hold) < 1e-4) this.hold = holding;
    }
    this.peak = Math.max(this.peak, this._progress);
    if (this._progress !== prevProgress || this.hold !== prevHold) this.dirty = true;
    this.uLighting.value = Math.min(1, Math.max(this._progress * 6, this.creaseMemory * this.peak * 3));
  }

  private ensureBake(aspect: number): void {
    if (this.bake && Math.abs(this.bake.aspect - aspect) < 0.01) return;
    const plane = this.plane!;
    const bake = bakeCrumple({
      segments: this.segments,
      aspect,
      seed: this.seed,
      foldCount: this.foldCount,
      ballRadius: this.ballRadius,
    });
    this.bake = bake;
    this.sim = new Float32Array(bake.vertexCount * 3);
    this.normals = new Float32Array(bake.vertexCount * 3);

    const geometry = plane.geometry;
    geometry.setIndex(new THREE.BufferAttribute(bake.index, 1));
    (geometry.getAttribute("uv") as THREE.BufferAttribute).copyArray(bake.uvs).needsUpdate = true;
    (geometry.getAttribute("position") as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    (geometry.getAttribute("normal") as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    this.dirty = true;
  }

  /** 補間したコマを plane の geometry 空間（x, y は板の幅・高さで 1、z は px）へ書く */
  private writeGeometry(w: number, h: number): void {
    const bake = this.bake!;
    const sim = this.sim!;
    const normals = this.normals!;
    const frames = bake.frames;
    const last = frames.length - 1;
    const f = this._progress * last;
    const i0 = Math.min(Math.floor(f), last - 1);
    const t = f - i0;
    const a = frames[i0];
    const b = frames[i0 + 1];
    // 一度丸めた紙は、戻しても浅い皺が残る
    const crease = frames[Math.round(last * CREASE_FRAME)];
    const rest = frames[0];
    const memory = this.creaseMemory * this.peak * (1 - this._progress);
    for (let i = 0; i < sim.length; i++) {
      sim[i] = a[i] + (b[i] - a[i]) * t + (crease[i] - rest[i]) * memory;
    }
    computeNormals(sim, bake.index, normals);

    const geometry = this.plane!.geometry;
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
    const pos = position.array as Float32Array;
    const aspect = h / w;
    const lift = this.lift * this.hold;
    for (let i = 0; i < sim.length; i += 3) {
      pos[i] = sim[i];
      pos[i + 1] = sim[i + 1] / aspect;
      pos[i + 2] = (sim[i + 2] + lift) * w;
    }
    (normal.array as Float32Array).set(normals);
    position.needsUpdate = true;
    normal.needsUpdate = true;
    this.dirty = false;
    this.written = { w, h };
  }

  /** 光の向きを保ったまま、影のカメラを plane の周りに合わせる */
  private updateLight(w: number, h: number): void {
    const light = this.light!;
    const mesh = this.plane!.mesh;
    light.visible = mesh.visible;
    const size = Math.max(w, h);
    const dir = this.uLightDir.value;
    light.target.position.copy(mesh.position);
    light.position.copy(mesh.position).addScaledVector(dir, size * 2);
    const cam = light.shadow.camera;
    const half = size * 0.9;
    if (cam.right !== half) {
      cam.left = -half;
      cam.right = half;
      cam.top = half;
      cam.bottom = -half;
      cam.near = 1;
      cam.far = size * 4;
      cam.updateProjectionMatrix();
    }
  }

  readonly colorNode = (ctx: PlaneNodeContext): Node =>
    Fn(() => {
      const tex = ctx.uTexture.sample(ctx.uv);
      // 見えている側を向く法線（表裏どちらを見ても光の当たり方が同じ式になる）
      const n0 = normalize(normalGeometry);
      const n = select(dot(n0, cameraPosition.sub(positionWorld)).greaterThanEqual(0), n0, n0.negate());
      const l = this.uLightDir;
      const ambient = float(0.55);
      const lit = ambient.add(ambient.oneMinus().mul(max(dot(n, l), 0)));
      // 平らなときにちょうど 1 になるよう、正面を向いた面の明るさで割る
      const flat = ambient.add(ambient.oneMinus().mul(max(l.z, 0)));
      const grain = fract(sin(dot(ctx.uv.mul(ctx.uResolution), vec2(12.9898, 78.233))).mul(43758.5453));
      const shade = lit.div(flat).mul(grain.sub(0.5).mul(0.05).add(1));
      const front = tex.rgb;
      const col = select(frontFacing, front, vec3(this.uBackColor));
      const alpha = select(frontFacing, tex.a, float(1));
      return vec4(col.mul(mix(float(1), shade, this.uLighting)), alpha.mul(ctx.uAlpha));
    })();
}
