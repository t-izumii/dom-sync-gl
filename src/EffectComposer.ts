import * as THREE from 'three';

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
    outputTarget: THREE.WebGLRenderTarget | null,
  ): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export interface EffectOptions {
  fragmentShader: string;
  uniforms?: { [key: string]: THREE.IUniform };
}

export interface EffectTarget {
  addEffect(options: EffectOptions): EffectPass;
  removeEffect(pass: EffectPass): boolean;
}

const defaultVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

export class EffectPass {
  readonly material: THREE.ShaderMaterial;
  enabled = true;

  constructor(material: THREE.ShaderMaterial) {
    this.material = material;
  }

  setUniform(key: string, value: unknown): void {
    if (this.material.uniforms[key] === undefined) {
      if (import.meta.env?.DEV) {
        console.warn(
          `[EffectPass] uniform "${key}" は定義されていません。タイポか、` +
          `BaseEffect.getConfig() の uniforms に追加し忘れている可能性があります。`
        );
      }
      return;
    }
    this.material.uniforms[key].value = value;
  }

  getUniform(key: string): THREE.IUniform | undefined {
    return this.material.uniforms[key];
  }
}

export class EffectComposer implements EffectTarget, EffectLike {
  private renderer: THREE.WebGLRenderer;
  private passes: Array<EffectPass> = [];

  private targetA: THREE.WebGLRenderTarget;
  private targetB: THREE.WebGLRenderTarget;
  // MSAA は scene を最初に描く target でのみ意味を持つ（中間の fullscreen pass に
  // は不要）。samples>0 のときだけ scene 描画専用の MSAA target を1枚確保し、
  // ping-pong 用の targetA/B は samples なしに保つ。null は MSAA 無効。
  private sceneTarget: THREE.WebGLRenderTarget | null = null;

  private postScene: THREE.Scene;
  private postCamera: THREE.OrthographicCamera;
  private postMesh: THREE.Mesh;
  private geometry: THREE.PlaneGeometry;
  // postMesh.material は render() 中に各 pass.material へ差し替えられるため、
  // 構築時に THREE.Mesh が自動生成する既定 material 自体はどの pass にも
  // 属さず誰も dispose しない。dispose() で確実に解放できるよう個別に保持する。
  private readonly postMeshDefaultMaterial: THREE.Material;

  private _disposed: boolean = false;

  constructor(
    renderer: THREE.WebGLRenderer,
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

    this.targetA = new THREE.WebGLRenderTarget(w, h, rtOptions);
    this.targetB = new THREE.WebGLRenderTarget(w, h, rtOptions);

    // WebGL1 等で maxSamples が 0 のときは MSAA 無効に落とす。
    const maxSamples = renderer.capabilities?.maxSamples ?? 0;
    const effectiveSamples = Math.min(Math.max(0, samples), maxSamples);
    if (effectiveSamples > 0) {
      this.sceneTarget = new THREE.WebGLRenderTarget(w, h, {
        ...rtOptions,
        samples: effectiveSamples,
      });
    }

    this.postScene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.postMesh = new THREE.Mesh(this.geometry);
    this.postMeshDefaultMaterial = this.postMesh.material as THREE.Material;
    this.postScene.add(this.postMesh);
  }

  /**
   * fullscreen pass を追加する。
   *
   * alpha 契約: 中間 RenderTarget と tDiffuse は premultiplied alpha。各 pass は
   * 前段の結果を丸ごと置き換えるため NoBlending で素通しする（NormalBlending だと
   * alpha が pass ごとに再乗算され透明部が暗くなる）。
   */
  addEffect(options: EffectOptions): EffectPass {
    if (this._disposed) {
      throw new Error('[EffectComposer] dispose 済みのインスタンスでは addEffect() できません。');
    }
    const material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        ...options.uniforms,
      },
      vertexShader: defaultVertexShader,
      fragmentShader: options.fragmentShader,
      transparent: false,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });

    const pass = new EffectPass(material);
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
    outputTarget: THREE.WebGLRenderTarget | null = null,
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
    const pingPong: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] = [
      this.targetA,
      this.targetB,
    ];
    let readTarget = sceneRT;
    let writeIndex = this.sceneTarget ? 0 : 1;

    for (let i = 0; i < passes.length; i++) {
      const pass = passes[i];
      if (!pass.enabled) continue;
      const isLast = i === lastActiveIndex;

      pass.material.uniforms['tDiffuse'].value = readTarget.texture;
      this.postMesh.material = pass.material;

      const writeTarget = pingPong[writeIndex];
      this.renderer.setRenderTarget(isLast ? outputTarget : writeTarget);
      this.renderer.render(this.postScene, this.postCamera);

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
    this.geometry.dispose();
    this.postMeshDefaultMaterial.dispose();
    for (const pass of this.passes) {
      pass.material.dispose();
    }
    this.passes = [];
  }
}
