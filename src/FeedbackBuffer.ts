import * as THREE from 'three';

/**
 * FeedbackBuffer — ping-pong RenderTarget で「状態を時間蓄積」する GPGPU プリミティブ。
 *
 * `BaseEffect`（post / フィルタ = 描画パイプラインに書き込む sink）とは出力の向きが逆で、
 * **テクスチャを産み出す source（generator）**。前フレームの自分の出力（`uPrev`）を読み、
 * 蓄積した新しい状態を書き出す。マウス軌跡（trail）・流体・拡散・反応拡散などに使う。
 *
 * 利用側はこの出力テクスチャ（{@link FeedbackBuffer.texture}）を別シェーダーの uniform
 * （例: plane の `uTrailTex`）に挿して材料として使う。{@link DomPlane.addFeedback} を使うと
 * この配線・毎フレ駆動・resize/dispose をライブラリ側が肩代わりする。
 *
 * **更新シェーダーに自動で渡る uniform**（宣言すれば使える）:
 * - `uPrev`      sampler2D : 前フレームの出力（蓄積の読み元）
 * - `uMouse`     vec2      : マウス UV (0..1)
 * - `uHover`     float     : hover 量 (0..1)
 * - `uTime`      float     : 経過秒
 * - `uResolution`vec2      : バッファ解像度 (size, size)
 * - `uAspect`    float     : 対象の縦横比 (w/h)
 *
 * @see https://github.com/t-izumii/dom-sync-gl
 */
export interface FeedbackBufferOptions {
  /** 蓄積を進める fragment shader（必須）。`uPrev` を読み新しい状態を出力する。 */
  fragmentShader: string;
  /** 任意の vertex shader。省略時は fullscreen quad の passthrough。 */
  vertexShader?: string;
  /**
   * ping-pong バッファの 1 辺の解像度（正方）。縦横比は `uAspect` で補正するので
   * バッファ自体は正方で固定する。大きいほど精細だが GPU 負荷増。
   * @default 256
   */
  size?: number;
  /** ユーザー定義 uniform（`uDecay` / `uRadius` 等）。実行時は {@link FeedbackBuffer.uniforms} で更新できる。 */
  uniforms?: Record<string, THREE.IUniform>;
}

/** {@link FeedbackBuffer.step} に渡す per-frame の入力。 */
export interface FeedbackInput {
  /** マウス UV (0..1)。`uMouse` に流す。 */
  mouse: THREE.Vector2;
  /** hover 量 (0..1)。`uHover` に流す。 */
  hover: number;
  /** 経過秒。`uTime` に流す。 */
  time: number;
  /** 対象の縦横比 (w/h)。`uAspect` に流す。 */
  aspect: number;
}

const defaultVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // fullscreen quad: clip 空間に直接出す（camera 非依存）。
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export class FeedbackBuffer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly _size: number;
  private readonly scene = new THREE.Scene();
  // passthrough vertex なので camera は実質ダミー（projection を使わない）。
  private readonly camera = new THREE.Camera();
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.ShaderMaterial;
  private read: THREE.WebGLRenderTarget;
  private write: THREE.WebGLRenderTarget;
  private disposed = false;

  constructor(renderer: THREE.WebGLRenderer, options: FeedbackBufferOptions) {
    this.renderer = renderer;
    this._size = options.size ?? 256;

    this.material = new THREE.ShaderMaterial({
      vertexShader: options.vertexShader ?? defaultVertexShader,
      fragmentShader: options.fragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPrev: { value: null },
        uMouse: { value: new THREE.Vector2(0.5, 0.5) },
        uHover: { value: 0 },
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(this._size, this._size) },
        uAspect: { value: 1 },
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
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
  }

  /** read/write を (0,0,0,0) で初期化（first frame のゴミ防止）。renderer の状態は復元する。 */
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

  /** 最新の出力テクスチャ（直近の蓄積結果）。plane の uniform 等に挿して使う。 */
  get texture(): THREE.Texture {
    return this.read.texture;
  }

  /** 更新シェーダーの uniform。`buffer.uniforms.uDecay.value = ...` で実行時に調整できる。 */
  get uniforms(): { [name: string]: THREE.IUniform } {
    return this.material.uniforms;
  }

  /** バッファ 1 辺の解像度。 */
  get size(): number {
    return this._size;
  }

  /**
   * 1 フレーム進める。`uPrev`（前フレーム）を読んで write に蓄積を焼き、swap して最新を read にする。
   * @returns 最新の出力テクスチャ。
   */
  step(input: FeedbackInput): THREE.Texture {
    if (this.disposed) return this.read.texture;

    const u = this.material.uniforms;
    u.uPrev.value = this.read.texture;
    (u.uMouse.value as THREE.Vector2).copy(input.mouse);
    u.uHover.value = input.hover;
    u.uTime.value = input.time;
    u.uAspect.value = input.aspect;

    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    r.setRenderTarget(this.write);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prevTarget);

    // swap: 焼いたばかりの write を最新 read にする。
    const tmp = this.read;
    this.read = this.write;
    this.write = tmp;
    return this.read.texture;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.read.dispose();
    this.write.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
