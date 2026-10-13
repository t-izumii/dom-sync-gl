/**
 * ポインタの軌跡から広がる波紋の高さ場（波動方程式）。
 *
 * 移植元は re3 の `SimpleFluidSim`（main.beautified.js L38468-L38501）。
 * r に今回、g に前回の高さを持つ ping-pong で、1/60 秒の固定刻みで進める。
 * 描画のフレームレートに依らず波の速さと減衰が一定になる。1 フレームで
 * 進める刻みは 5 回までに抑え、重い環境でさらに重くなる悪循環を避ける。
 * 刻みの端数は `interpolation` として返し、読む側が前回と今回を補間する。
 */
import * as THREE from 'three/webgpu';
import {
  clamp,
  dot,
  float,
  length,
  max,
  select,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec4,
} from 'three/tsl';
import type { UniformNode } from 'three/webgpu';

const STEP = 1 / 60;
const MAX_STEPS = 5;

export interface WaveStepParams {
  damping: number;
  trailSize: number;
}

export class WaveSim {
  private readonly renderer: THREE.WebGPURenderer;
  private readonly quad = new THREE.QuadMesh();
  private readonly material: THREE.MeshBasicNodeMaterial;

  private readonly map = texture();
  private readonly uTexelSize = uniform(new THREE.Vector2(1, 1));
  private readonly uAspect = uniform(new THREE.Vector2(1, 1));
  private readonly uPointer = uniform(new THREE.Vector2());
  private readonly uOldPointer = uniform(new THREE.Vector2());
  private readonly uRenderPointer = uniform(0);
  private readonly uDamping = uniform(0.98);
  private readonly uTrailSize = uniform(0.035);

  private read: THREE.RenderTarget | null = null;
  private write: THREE.RenderTarget | null = null;
  private cleared = false;
  private accumulator = 0;
  private readonly oldPointer = new THREE.Vector2();
  private hasOldPointer = false;
  private pointerPending = false;

  /** 最後の刻みからの端数（0〜1）。前回の高さ（g）と今回（r）の補間に使う */
  interpolation = 0;

  constructor(renderer: THREE.WebGPURenderer, uSeconds: UniformNode<number>) {
    this.renderer = renderer;

    const vUv = uv();
    const vUvA = vUv.mul(this.uAspect);
    const pA = this.uPointer.mul(this.uAspect);
    const oPA = this.uOldPointer.mul(this.uAspect);
    const po = pA.sub(oPA);
    const lpo = length(po);
    const npo = po.div(max(lpo, 1e-6));
    const projected = oPA.add(npo.mul(clamp(dot(vUvA.sub(oPA), npo), 0, lpo)));
    const d = select(lpo.lessThan(1e-4), length(vUvA.sub(pA)), length(vUvA.sub(projected)));
    // 線の太さは 4π rad/s で脈打つ。原典の smoothstep(size, 0, d) は端点が
    // 逆順で WGSL では未定義なので、1 - smoothstep(0, size, d) と書く
    const size = this.uTrailSize.add(sin(uSeconds.mul(Math.PI * 4)).mul(0.02));
    const ripple = float(1)
      .sub(smoothstep(0, size, d))
      .mul(smoothstep(0, 0.01, lpo))
      .mul(this.uRenderPointer);

    const e = this.uTexelSize.mul(3.6);
    const t = this.map.sample(vUv.sub(vec2(0, e.y))).x;
    const b = this.map.sample(vUv.add(vec2(e.x, 0))).x;
    const l = this.map.sample(vUv.add(vec2(0, e.y))).x;
    const r = this.map.sample(vUv.sub(vec2(e.x, 0))).x;
    const prev = this.map.sample(vUv).xy;
    const height = ripple.mul(2).add(t.add(r).add(b).add(l).mul(0.5)).sub(prev.y).mul(this.uDamping);

    this.material = new THREE.MeshBasicNodeMaterial();
    this.material.fragmentNode = vec4(height, prev.x, 0, 1);
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.material.blending = THREE.NoBlending;
  }

  get texture(): THREE.Texture | null {
    return this.read?.texture ?? null;
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

  /** 画面（CSS px）の scale 倍の解像度で持つ。変わらないときは作り直さない */
  buildFramebuffers(viewportWidth: number, viewportHeight: number, scale: number): void {
    const w = Math.max(1, Math.floor(viewportWidth * scale));
    const h = Math.max(1, Math.floor(viewportHeight * scale));
    this.uTexelSize.value.set(1 / w, 1 / h);
    // 短辺を 1 にして、波紋が縦長・横長の画面でも真円になるようにする
    const aspect = viewportWidth / Math.max(1, viewportHeight);
    this.uAspect.value.set(aspect > 1 ? aspect : 1, aspect > 1 ? 1 : 1 / aspect);

    if (this.read && this.read.width === w && this.read.height === h) return;
    this.read?.dispose();
    this.write?.dispose();
    this.read = this.makeTarget(w, h);
    this.write = this.makeTarget(w, h);
    this.cleared = false;
  }

  /** ポインタが動いたことを伝える。次に刻みが進むときに 1 回だけ波を足す */
  notifyPointer(): void {
    this.pointerPending = true;
  }

  /** 前回位置を合わせ直す。離れた位置から長い線を引かないようにする */
  resetPointer(pointer: THREE.Vector2): void {
    this.oldPointer.copy(pointer);
    this.hasOldPointer = true;
    this.pointerPending = false;
  }

  /**
   * @param dt 経過秒
   * @param pointer 現在のポインタ（UV・左上原点）
   */
  step(dt: number, pointer: THREE.Vector2, params: WaveStepParams): void {
    let read = this.read;
    let write = this.write;
    if (!read || !write) return;
    if (!this.hasOldPointer) this.resetPointer(pointer);

    const prevRT = this.renderer.getRenderTarget();
    if (!this.cleared) {
      const prevAlpha = this.renderer.getClearAlpha();
      const prevColor = this.renderer.getClearColor(
        new THREE.Color() as unknown as Parameters<THREE.WebGPURenderer['getClearColor']>[0],
      );
      this.renderer.setClearColor(0x000000, 0);
      for (const t of [read, write]) {
        this.renderer.setRenderTarget(t);
        this.renderer.clear();
      }
      this.renderer.setClearColor(prevColor, prevAlpha);
      this.cleared = true;
    }

    this.uDamping.value = params.damping;
    this.uTrailSize.value = params.trailSize;
    this.uPointer.value.copy(pointer);
    this.quad.material = this.material;

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= STEP && steps < MAX_STEPS) {
      this.uOldPointer.value.copy(this.oldPointer);
      this.uRenderPointer.value = this.pointerPending ? 1 : 0;
      this.map.value = read.texture;
      this.renderer.setRenderTarget(write);
      this.quad.render(this.renderer);
      [read, write] = [write, read];

      // 波を足すのは最初の刻みだけ。残りの刻みは伝播と減衰だけ進める
      this.pointerPending = false;
      this.oldPointer.copy(pointer);
      this.accumulator -= STEP;
      steps++;
    }
    this.read = read;
    this.write = write;
    this.interpolation = Math.min(this.accumulator / STEP, 1);

    this.renderer.setRenderTarget(prevRT);
  }

  dispose(): void {
    this.read?.dispose();
    this.write?.dispose();
    this.read = null;
    this.write = null;
    this.material.dispose();
  }
}
