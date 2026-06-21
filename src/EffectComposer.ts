import * as THREE from 'three';

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

  private postScene: THREE.Scene;
  private postCamera: THREE.OrthographicCamera;
  private postMesh: THREE.Mesh;
  private geometry: THREE.PlaneGeometry;

  private _disposed: boolean = false;

  constructor(renderer: THREE.WebGLRenderer, width: number, height: number) {
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

  removeEffect(pass: EffectPass): boolean {
    if (this._disposed) return false;
    const idx = this.passes.indexOf(pass);
    if (idx < 0) return false;
    this.passes.splice(idx, 1);
    pass.material.dispose();
    return true;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this._disposed) return;

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
