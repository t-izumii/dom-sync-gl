import * as THREE from 'three';
import type GUI from 'lil-gui';

export interface FeedbackBufferOptions {
  fragmentShader: string;
  vertexShader?: string;
  size?: number;
  /**
   * 追加のカスタム uniform。以下の予約名は FeedbackBuffer が内部で生成・毎フレーム
   * 更新するため渡せない（渡すと throw する）:
   * `uPrev` / `uMouse` / `uPrevMouse` / `uHover` / `uTime` / `uResolution` /
   * `uAspect` / `uMove`。
   */
  uniforms?: Record<string, THREE.IUniform>;

  setupGUI?: (gui: GUI, buffer: FeedbackBuffer) => GUI | void;
  /**
   * @default 0.0008
   */
  moveThreshold?: number;
  /**
   *
   * @default 0.01
   */
  moveScale?: number;
  /**
   *
   * @default 0.85
   */
  moveRelease?: number;
}

export interface FeedbackInput {
  mouse: THREE.Vector2;
  hover: number;
  time: number;
  aspect: number;
}

const defaultVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// これらの uniform は FeedbackBuffer が内部で生成・毎フレーム更新するため、
// options.uniforms から同名を渡すと内部処理が壊れる。予約名として上書きを禁止する。
const RESERVED_UNIFORM_NAMES: readonly string[] = [
  "uPrev",
  "uMouse",
  "uPrevMouse",
  "uHover",
  "uTime",
  "uResolution",
  "uAspect",
  "uMove",
];

export class FeedbackBuffer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly _size: number;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.ShaderMaterial;
  private read: THREE.WebGLRenderTarget;
  private write: THREE.WebGLRenderTarget;
  private disposed = false;

  private readonly _prevMouse = new THREE.Vector2();
  private _hasPrevMouse = false;
  private _moveThreshold: number;
  private _moveScale: number;
  private _moveRelease: number;
  private _gui: GUI | null = null;

  constructor(renderer: THREE.WebGLRenderer, options: FeedbackBufferOptions) {
    // 予約 uniform を options.uniforms で上書きされると内部処理が壊れるため fail-fast で弾く。
    if (options.uniforms) {
      for (const name of RESERVED_UNIFORM_NAMES) {
        if (name in options.uniforms) {
          throw new Error(
            `[FeedbackBuffer] uniform "${name}" は予約済みで内部管理されます。` +
              `options.uniforms から渡さないでください（予約名: ${RESERVED_UNIFORM_NAMES.join(", ")}）。`,
          );
        }
      }
    }

    this.renderer = renderer;
    this._size = options.size ?? 256;
    this._moveThreshold = options.moveThreshold ?? 0.0008;
    this._moveScale = options.moveScale ?? 0.01;
    this._moveRelease = options.moveRelease ?? 0.85;

    this.material = new THREE.ShaderMaterial({
      vertexShader: options.vertexShader ?? defaultVertexShader,
      fragmentShader: options.fragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPrev: { value: null },
        uMouse: { value: new THREE.Vector2(0.5, 0.5) },
        uPrevMouse: { value: new THREE.Vector2(0.5, 0.5) },
        uHover: { value: 0 },
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(this._size, this._size) },
        uAspect: { value: 1 },
        uMove: { value: 0 },
        ...options.uniforms,
      },
    });
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.scene.add(new THREE.Mesh(this.geometry, this.material));

    this.read = this.makeTarget();
    this.write = this.makeTarget();
    this.clearTargets();
  }

  private makeTarget(): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(this._size, this._size, {
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
  }

  private clearTargets(): void {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevColor = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.read);
    r.clear();
    r.setRenderTarget(this.write);
    r.clear();
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevColor, prevAlpha);
  }

  get texture(): THREE.Texture {
    return this.read.texture;
  }

  get uniforms(): { [name: string]: THREE.IUniform } {
    return this.material.uniforms;
  }

  get size(): number {
    return this._size;
  }

  get moveThreshold(): number {
    return this._moveThreshold;
  }
  set moveThreshold(v: number) {
    this._moveThreshold = Math.max(0, v);
  }

  get moveScale(): number {
    return this._moveScale;
  }
  set moveScale(v: number) {
    this._moveScale = Math.max(1e-6, v);
  }

  get moveRelease(): number {
    return this._moveRelease;
  }
  set moveRelease(v: number) {
    this._moveRelease = Math.min(1, Math.max(0, v));
  }

  step(input: FeedbackInput): THREE.Texture {
    if (this.disposed) return this.read.texture;

    const u = this.material.uniforms;
    u.uPrev.value = this.read.texture;
    (u.uMouse.value as THREE.Vector2).copy(input.mouse);
    u.uHover.value = input.hover;
    u.uTime.value = input.time;
    u.uAspect.value = input.aspect;

    let move = 0;
    if (this._hasPrevMouse) {
      const dx = (input.mouse.x - this._prevMouse.x) * input.aspect;
      const dy = input.mouse.y - this._prevMouse.y;
      const dist = Math.hypot(dx, dy);
      move =
        dist > this._moveThreshold ? Math.min(1, dist / this._moveScale) : 0;
    }
    (u.uPrevMouse.value as THREE.Vector2).copy(
      this._hasPrevMouse ? this._prevMouse : input.mouse
    );
    this._prevMouse.copy(input.mouse);
    this._hasPrevMouse = true;
    u.uMove.value = Math.max(
      move,
      (u.uMove.value as number) * this._moveRelease
    );

    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    r.setRenderTarget(this.write);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prevTarget);

    const tmp = this.read;
    this.read = this.write;
    this.write = tmp;
    return this.read.texture;
  }

  _attachGUI(gui: GUI): void {
    if (this.disposed) {
      gui.destroy();
      return;
    }
    this._gui = gui;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this._gui?.destroy();
    this._gui = null;
    this.read.dispose();
    this.write.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
