import * as THREE from 'three/webgpu';
import { texture, uv } from 'three/tsl';
import type { Node, TextureNode, UniformNode } from 'three/webgpu';

export interface EffectLike {
  /**
   * scene/camera を最終出力先へ描画する。
   *
   * 契約: 呼び出し前にバインドされていた RenderTarget を呼び出し後も維持する
   * （内部で中間 FBO を使う実装は getRenderTarget/setRenderTarget で保存・復元する）。
   * 最終出力は outputTarget（null は画面）にのみ書き、他の RenderTarget を残さない。
   * この契約により、外部が FBO をバインドした状態で呼んでも破壊されない。
   */
  render(
    scene: THREE.Scene,
    camera: THREE.Camera,
    outputTarget: THREE.RenderTarget | null,
  ): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

/**
 * outputNode ファクトリに渡されるコンテキスト。
 * TSL ノードは pass 追加時に一度だけ構築され、以後は uniform / texture の
 * `.value` 差し替えのみで毎フレーム更新される。
 */
export interface EffectContext {
  /** 前段パスの出力を読む texture ノード。そのまま使うと uv() でサンプルされる */
  inputTexture: TextureNode;
  /** スクリーン UV ノード */
  uv: Node;
}

export interface EffectOptions {
  /** vec4 の色ノードを返すファクトリ。pass 追加時に一度だけ呼ばれる */
  outputNode: (ctx: EffectContext) => Node;
  /** uniform() で生成したノードの名前つきマップ。setUniform/getUniform で参照される */
  uniforms?: Record<string, UniformNode<unknown>>;
}

export interface EffectTarget {
  addEffect(options: EffectOptions): EffectPass;
  removeEffect(pass: EffectPass): boolean;
}

export class EffectPass {
  readonly material: THREE.MeshBasicNodeMaterial;
  /** ping-pong の読み取り元 RT を毎パス差し替えるための入力テクスチャノード */
  readonly inputTexture: TextureNode;
  enabled = true;

  private readonly uniformNodes: Record<string, UniformNode<unknown>>;

  constructor(
    material: THREE.MeshBasicNodeMaterial,
    inputTexture: TextureNode,
    uniformNodes: Record<string, UniformNode<unknown>>,
  ) {
    this.material = material;
    this.inputTexture = inputTexture;
    this.uniformNodes = uniformNodes;
  }

  setUniform(key: string, value: unknown): void {
    const node = this.uniformNodes[key];
    if (node === undefined) {
      if (import.meta.env?.DEV) {
        console.warn(
          `[EffectPass] uniform "${key}" は定義されていません。タイポか、` +
          `BaseEffect.getConfig() の uniforms に追加し忘れている可能性があります。`
        );
      }
      return;
    }
    node.value = value;
  }

  getUniform(key: string): UniformNode<unknown> | undefined {
    return this.uniformNodes[key];
  }
}

export class EffectComposer implements EffectTarget, EffectLike {
  private renderer: THREE.WebGPURenderer;
  private passes: Array<EffectPass> = [];

  private targetA: THREE.RenderTarget;
  private targetB: THREE.RenderTarget;
  // MSAA は scene を最初に描く target でのみ意味を持つ（中間の fullscreen pass に
  // は不要）。samples>0 のときだけ scene 描画専用の MSAA target を1枚確保し、
  // ping-pong 用の targetA/B は samples なしに保つ。null は MSAA 無効。
  private sceneTarget: THREE.RenderTarget | null = null;

  // fullscreen pass の描画は自前の ortho カメラではなく QuadMesh に任せる。
  // 自前 ortho の clip 空間 z は WebGL([-1,1]) と WebGPU([0,1]) で異なり
  // 描画が欠けうるため、両バックエンドを吸収する公式ヘルパーを使う。
  private quad: THREE.QuadMesh;

  private _disposed: boolean = false;

  constructor(
    renderer: THREE.WebGPURenderer,
    width: number,
    height: number,
    samples: number = 0,
  ) {
    this.renderer = renderer;

    const dpr = renderer.getPixelRatio();

    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));

    const rtOptions: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      stencilBuffer: false,
    };

    this.targetA = new THREE.RenderTarget(w, h, rtOptions);
    this.targetB = new THREE.RenderTarget(w, h, rtOptions);

    // WebGPURenderer は init() 完了まで capabilities を提供しない場合があるため、
    // 取得できないときは WebGPU の標準サンプル数 4 を上限として扱う。
    const caps = (
      renderer as unknown as { capabilities?: { maxSamples?: number } }
    ).capabilities;
    const maxSamples = caps?.maxSamples ?? 4;
    const effectiveSamples = Math.min(Math.max(0, samples), maxSamples);
    if (effectiveSamples > 0) {
      this.sceneTarget = new THREE.RenderTarget(w, h, {
        ...rtOptions,
        samples: effectiveSamples,
      });
    }

    this.quad = new THREE.QuadMesh();
  }

  /**
   * fullscreen pass を追加する。
   *
   * alpha 契約: 中間 RenderTarget と inputTexture は premultiplied alpha。各 pass は
   * 前段の結果を丸ごと置き換えるため NoBlending で素通しする（NormalBlending だと
   * alpha が pass ごとに再乗算され透明部が暗くなる）。
   *
   * material は MeshBasicNodeMaterial の colorNode を使う（fragmentNode ではなく）。
   * fragmentNode は出力の色空間変換まで素通しするため、最終 pass を画面に描く際に
   * linear→sRGB 変換が掛からず暗くなる。colorNode なら中間 RT へは無変換・画面へは
   * 出力変換ありという renderer 既定のパイプラインに乗る。
   */
  addEffect(options: EffectOptions): EffectPass {
    if (this._disposed) {
      throw new Error('[EffectComposer] dispose 済みのインスタンスでは addEffect() できません。');
    }
    const inputTexture = texture(this.targetA.texture);
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = options.outputNode({ inputTexture, uv: uv() });
    material.transparent = false;
    material.depthTest = false;
    material.depthWrite = false;
    material.blending = THREE.NoBlending;

    const pass = new EffectPass(material, inputTexture, {
      ...options.uniforms,
    });
    this.passes.push(pass);
    return pass;
  }

  removeEffect(pass: EffectPass): boolean {
    if (this._disposed) return false;
    const idx = this.passes.indexOf(pass);
    if (idx < 0) return false;
    this.passes.splice(idx, 1);
    pass.material.dispose();
    return true;
  }

  render(
    scene: THREE.Scene,
    camera: THREE.Camera,
    outputTarget: THREE.RenderTarget | null = null,
  ): void {
    if (this._disposed) return;

    // 外部がバインドした RenderTarget を壊さないよう、全経路で保存・復元する。
    const prevTarget = this.renderer.getRenderTarget();

    let activeCount = 0;
    let lastActiveIndex = -1;
    const passes = this.passes;
    for (let i = 0, n = passes.length; i < n; i++) {
      if (passes[i].enabled) {
        activeCount++;
        lastActiveIndex = i;
      }
    }

    if (activeCount === 0) {
      this.renderer.setRenderTarget(outputTarget);
      this.renderer.render(scene, camera);
      this.renderer.setRenderTarget(prevTarget);
      return;
    }

    // MSAA 有効時は専用の sceneTarget へ、無効時は targetA へ scene を描く。
    // three は MSAA target の texture 読み出し時に自動 resolve する。
    const sceneRT = this.sceneTarget ?? this.targetA;
    this.renderer.setRenderTarget(sceneRT);
    this.renderer.render(scene, camera);

    // ping-pong は samples なしの targetA/B のみで往復する。sceneTarget を使う
    // 場合は両方空くので targetA(index 0) から、使わない場合は targetA が読み取り
    // 元なので targetB(index 1) から書き始める。
    const pingPong: [THREE.RenderTarget, THREE.RenderTarget] = [
      this.targetA,
      this.targetB,
    ];
    let readTarget = sceneRT;
    let writeIndex = this.sceneTarget ? 0 : 1;

    for (let i = 0; i < passes.length; i++) {
      const pass = passes[i];
      if (!pass.enabled) continue;
      const isLast = i === lastActiveIndex;

      pass.inputTexture.value = readTarget.texture;
      this.quad.material = pass.material;

      const writeTarget = pingPong[writeIndex];
      this.renderer.setRenderTarget(isLast ? outputTarget : writeTarget);
      this.quad.render(this.renderer);

      if (!isLast) {
        readTarget = writeTarget;
        writeIndex = writeIndex === 0 ? 1 : 0;
      }
    }

    this.renderer.setRenderTarget(prevTarget);
  }

  resize(width: number, height: number): void {
    if (this._disposed) return;
    const dpr = this.renderer.getPixelRatio();
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    this.targetA.setSize(w, h);
    this.targetB.setSize(w, h);
    this.sceneTarget?.setSize(w, h);
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.targetA.dispose();
    this.targetB.dispose();
    this.sceneTarget?.dispose();
    // QuadMesh の geometry は全インスタンス共有のため dispose してはいけない。
    // 解放対象は pass ごとの material のみ。
    for (const pass of this.passes) {
      pass.material.dispose();
    }
    this.passes = [];
  }
}
