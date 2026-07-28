import * as THREE from 'three/webgpu';
import { texture, uniform, uv } from 'three/tsl';
import type { Node, TextureNode, UniformNode } from 'three/webgpu';
import type GUI from 'lil-gui';

/**
 * outputNode ファクトリに渡されるコンテキスト。
 * ノードは構築時に一度だけ作られ、以後は step() が `.value` を毎フレーム更新する。
 */
export interface FeedbackContext {
  /** 前フレームの自身の出力を読む texture ノード */
  uPrev: TextureNode;
  uMouse: UniformNode<THREE.Vector2>;
  uPrevMouse: UniformNode<THREE.Vector2>;
  uHover: UniformNode<number>;
  uTime: UniformNode<number>;
  uResolution: UniformNode<THREE.Vector2>;
  uAspect: UniformNode<number>;
  uMove: UniformNode<number>;
  /** options.uniforms で渡したユーザー uniform */
  uniforms: Record<string, UniformNode<unknown>>;
  uv: Node;
}

export interface FeedbackBufferOptions {
  /** vec4 の色ノードを返すファクトリ。構築時に一度だけ呼ばれる */
  outputNode: (ctx: FeedbackContext) => Node;
  size?: number;
  /**
   * 追加のカスタム uniform。以下の予約名は FeedbackBuffer が内部で生成・毎フレーム
   * 更新し ctx 経由で渡すため使えない（渡すと throw する）:
   * `uPrev` / `uMouse` / `uPrevMouse` / `uHover` / `uTime` / `uResolution` /
   * `uAspect` / `uMove`。
   */
  uniforms?: Record<string, UniformNode<unknown>>;

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

// FeedbackBuffer が内部で生成・毎フレーム更新する uniform。
// options.uniforms からの上書きは内部処理を壊すため予約名として禁止する。
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
  private readonly renderer: THREE.WebGPURenderer;
  private readonly _size: number;
  // fullscreen 描画は QuadMesh に任せる（clip 空間 z の WebGL/WebGPU 差の吸収。
  // Why の詳細は EffectComposer の quad 宣言部を参照）。
  private readonly quad: THREE.QuadMesh;
  private readonly material: THREE.MeshBasicNodeMaterial;
  private read: THREE.RenderTarget;
  private write: THREE.RenderTarget;
  private disposed = false;
  // renderer.init() 完了前に GPU コマンドを発行できないため、RT の初期クリアは
  // コンストラクタではなく初回 step()（render ループ内 = init 完了後）まで遅延する。
  private cleared = false;

  private readonly nodes: {
    uPrev: TextureNode;
    uMouse: UniformNode<THREE.Vector2>;
    uPrevMouse: UniformNode<THREE.Vector2>;
    uHover: UniformNode<number>;
    uTime: UniformNode<number>;
    uResolution: UniformNode<THREE.Vector2>;
    uAspect: UniformNode<number>;
    uMove: UniformNode<number>;
  };
  private readonly userUniforms: Record<string, UniformNode<unknown>>;

  private readonly _prevMouse = new THREE.Vector2();
  private _hasPrevMouse = false;
  private _moveThreshold: number;
  private _moveScale: number;
  private _moveRelease: number;
  private _gui: GUI | null = null;

  constructor(renderer: THREE.WebGPURenderer, options: FeedbackBufferOptions) {
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

    this.read = this.makeTarget();
    this.write = this.makeTarget();

    const uPrev = texture(this.read.texture);
    const uMouse = uniform(new THREE.Vector2(0.5, 0.5));
    const uPrevMouse = uniform(new THREE.Vector2(0.5, 0.5));
    const uHover = uniform(0);
    const uTime = uniform(0);
    const uResolution = uniform(new THREE.Vector2(this._size, this._size));
    const uAspect = uniform(1);
    const uMove = uniform(0);
    this.nodes = {
      uPrev,
      uMouse,
      uPrevMouse,
      uHover,
      uTime,
      uResolution,
      uAspect,
      uMove,
    };
    this.userUniforms = { ...options.uniforms };

    this.material = new THREE.MeshBasicNodeMaterial();
    this.material.colorNode = options.outputNode({
      uPrev,
      uMouse,
      uPrevMouse,
      uHover,
      uTime,
      uResolution,
      uAspect,
      uMove,
      uniforms: this.userUniforms,
      uv: uv(),
    });
    this.material.depthTest = false;
    this.material.depthWrite = false;
    // 旧実装（transparent: false の ShaderMaterial）は実質 blend なしで RT を
    // 丸ごと置き換えていた。バックエンド差で挙動が揺れないよう明示する。
    this.material.blending = THREE.NoBlending;

    this.quad = new THREE.QuadMesh(this.material);
  }

  private makeTarget(): THREE.RenderTarget {
    return new THREE.RenderTarget(this._size, this._size, {
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
    // WebGPURenderer の getClearColor は Color4 を要求するが、three/webgpu は
    // Color4 をランタイム export していないため Color を流用する（copy で rgb が
    // 写り、alpha は getClearAlpha() で別途保存・復元する）。
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

  get texture(): THREE.Texture {
    return this.read.texture;
  }

  /** 内部管理ノード（予約名）とユーザー uniform をまとめた参照。`.value` 更新用 */
  get uniforms(): Record<string, UniformNode<unknown>> {
    return {
      ...(this.nodes as unknown as Record<string, UniformNode<unknown>>),
      ...this.userUniforms,
    };
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

    if (!this.cleared) {
      this.clearTargets();
      this.cleared = true;
    }

    const n = this.nodes;
    n.uPrev.value = this.read.texture;
    n.uMouse.value.copy(input.mouse);
    n.uHover.value = input.hover;
    n.uTime.value = input.time;
    n.uAspect.value = input.aspect;

    let move = 0;
    if (this._hasPrevMouse) {
      const dx = (input.mouse.x - this._prevMouse.x) * input.aspect;
      const dy = input.mouse.y - this._prevMouse.y;
      const dist = Math.hypot(dx, dy);
      move =
        dist > this._moveThreshold ? Math.min(1, dist / this._moveScale) : 0;
    }
    n.uPrevMouse.value.copy(
      this._hasPrevMouse ? this._prevMouse : input.mouse
    );
    this._prevMouse.copy(input.mouse);
    this._hasPrevMouse = true;
    n.uMove.value = Math.max(move, n.uMove.value * this._moveRelease);

    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    r.setRenderTarget(this.write);
    this.quad.render(r);
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
    // QuadMesh の geometry は全インスタンス共有のため dispose してはいけない。
    this.material.dispose();
  }
}
