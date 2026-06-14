import * as THREE from 'three';

/**
 * `DomSyncGL.setPostEffect()` で差し込めるポストエフェクトの最小契約。
 * `EffectComposer` は実装している。自前で差し込みたい場合は構造的にこれを満たせばよい。
 */
export interface EffectLike {
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export interface EffectOptions {
  fragmentShader: string;
  uniforms?: { [key: string]: THREE.IUniform };
}

export interface EffectTarget {
  addEffect(options: EffectOptions): EffectPass;
}

const defaultVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

/**
 * addEffect() で返されるハンドル。uniform の更新に使う。
 */
export class EffectPass {
  readonly material: THREE.ShaderMaterial;
  /** false の時、EffectComposer はこのパスをスキップする（パススルー扱い）。 */
  enabled = true;

  constructor(material: THREE.ShaderMaterial) {
    this.material = material;
  }

  setUniform(key: string, value: unknown): void {
    if (this.material.uniforms[key] === undefined) {
      // dev 環境のみ警告。本番（minify 済み）では import.meta.env.DEV が false でスキップされる。
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

/**
 * 複数のポストエフェクトをチェーンで適用するクラス。
 *
 * RenderTarget はピンポン方式で2つのみ使用。
 * エフェクト数に関わらずメモリ使用量は一定。
 *
 * render flow (エフェクト3つの場合):
 *   scene → TargetA
 *   pass1: A → B
 *   pass2: B → A
 *   pass3: A → canvas (null)
 */
export class EffectComposer implements EffectTarget, EffectLike {
  private renderer: THREE.WebGLRenderer;
  private passes: Array<EffectPass> = [];

  private targetA: THREE.WebGLRenderTarget;
  private targetB: THREE.WebGLRenderTarget;

  private postScene: THREE.Scene;
  private postCamera: THREE.OrthographicCamera;
  private postMesh: THREE.Mesh;
  private geometry: THREE.PlaneGeometry;

  /**
   * dispose 後の API 呼び出しを no-op にするフラグ。
   * dispose 済みの RT に render すると INVALID_OPERATION になるため。
   */
  private _disposed: boolean = false;

  constructor(renderer: THREE.WebGLRenderer, width: number, height: number) {
    this.renderer = renderer;

    const dpr = renderer.getPixelRatio();
    // width/height が 0 を取ると WebGL が INVALID_VALUE を出す実装があるので
    // 1 px 未満にならないようにガードする。
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

    this.postScene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.postMesh = new THREE.Mesh(this.geometry);
    this.postScene.add(this.postMesh);
  }

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
      transparent: true,
    });

    const pass = new EffectPass(material);
    this.passes.push(pass);
    return pass;
  }

  /**
   * 登録済みパスを 1 つ取り除いて material を dispose する。
   * `addEffect()` の戻り値か、`BaseEffect.getPass()` の値を渡す。
   * 存在しない pass を渡した時は何もしない。
   */
  removeEffect(pass: EffectPass): boolean {
    if (this._disposed) return false;
    const idx = this.passes.indexOf(pass);
    if (idx < 0) return false;
    this.passes.splice(idx, 1);
    pass.material.dispose();
    return true;
  }

  /**
   * シーンをレンダリングし、登録されたエフェクトを順に適用する。
   * エフェクトが0個の場合は通常レンダリング。
   */
  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this._disposed) return;
    // 無効化されたパスは丸ごとスキップ。チェーン途中で off にしても残りが正しく繋がる
    // よう、active なものだけ走らせる。filter() で配列を毎フレ alloc すると GC 圧に
    // なるので、active 数のカウントと最後の active index だけ取り出して in-place で回す。
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
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }

    // シーンを TargetA に描画
    this.renderer.setRenderTarget(this.targetA);
    this.renderer.render(scene, camera);

    let readTarget = this.targetA;
    let writeTarget = this.targetB;

    for (let i = 0; i < passes.length; i++) {
      const pass = passes[i];
      if (!pass.enabled) continue;
      const isLast = i === lastActiveIndex;

      pass.material.uniforms['tDiffuse'].value = readTarget.texture;
      this.postMesh.material = pass.material;

      this.renderer.setRenderTarget(isLast ? null : writeTarget);
      this.renderer.render(this.postScene, this.postCamera);

      if (!isLast) {
        const tmp = readTarget;
        readTarget = writeTarget;
        writeTarget = tmp;
      }
    }
  }

  resize(width: number, height: number): void {
    if (this._disposed) return;
    const dpr = this.renderer.getPixelRatio();
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    this.targetA.setSize(w, h);
    this.targetB.setSize(w, h);
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.targetA.dispose();
    this.targetB.dispose();
    this.geometry.dispose();
    for (const pass of this.passes) {
      pass.material.dispose();
    }
    this.passes = [];
  }
}
