import * as THREE from 'three';
import type { EffectOptions, EffectTarget } from './EffectComposer';
import { EffectPass } from './EffectComposer';

const defaultVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

export class PlaneComposer implements EffectTarget {
  private renderer: THREE.WebGLRenderer;
  private sourceMesh: THREE.Mesh;
  private passes: EffectPass[] = [];

  private targetA: THREE.WebGLRenderTarget;
  private targetB: THREE.WebGLRenderTarget;

  private localScene: THREE.Scene;
  private localCamera: THREE.OrthographicCamera;
  private localMesh: THREE.Mesh;

  private postScene: THREE.Scene;
  private postCamera: THREE.OrthographicCamera;
  private postMesh: THREE.Mesh;
  private postGeo: THREE.PlaneGeometry;
  // postMesh.material は render() 中に各 pass.material へ差し替えられるため、
  // 構築時に THREE.Mesh が自動生成する既定 material 自体はどの pass にも
  // 属さず誰も dispose しない。dispose() で確実に解放できるよう個別に保持する。
  private readonly postMeshDefaultMaterial: THREE.Material;

  private proxyMesh: THREE.Mesh;
  private proxyMaterial: THREE.MeshBasicMaterial;
  private proxyGeo: THREE.PlaneGeometry;
  private mainScene: THREE.Scene;

  private _bypassed: boolean = false;
  private _disposed: boolean = false;

  constructor(
    renderer: THREE.WebGLRenderer,
    sourceMesh: THREE.Mesh,
    mainScene: THREE.Scene,
    width: number,
    height: number,
  ) {
    this.renderer = renderer;
    this.sourceMesh = sourceMesh;
    this.mainScene = mainScene;

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

    this.localScene = new THREE.Scene();
    this.localCamera = new THREE.OrthographicCamera(
      -width / 2, width / 2, height / 2, -height / 2, 0.1, 10,
    );
    this.localCamera.position.set(0, 0, 1);

    this.localMesh = new THREE.Mesh(sourceMesh.geometry, sourceMesh.material);
    this.localMesh.position.set(0, 0, 0);
    this.localMesh.scale.copy(sourceMesh.scale);
    this.localScene.add(this.localMesh);

    this.postScene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postGeo = new THREE.PlaneGeometry(2, 2);
    this.postMesh = new THREE.Mesh(this.postGeo);
    this.postMeshDefaultMaterial = this.postMesh.material as THREE.Material;
    this.postScene.add(this.postMesh);

    mainScene.remove(sourceMesh);

    this.proxyMaterial = new THREE.MeshBasicMaterial({
      map: this.targetA.texture,
      transparent: true,
      // RenderTarget の内容は premultiplied alpha なので (ONE, ONE_MINUS_SRC_ALPHA)
      // で合成し、alpha の再乗算を防ぐ。
      premultipliedAlpha: true,
    });
    this.proxyGeo = new THREE.PlaneGeometry(1, 1);
    this.proxyMesh = new THREE.Mesh(this.proxyGeo, this.proxyMaterial);
    this.proxyMesh.position.copy(sourceMesh.position);
    this.proxyMesh.scale.copy(sourceMesh.scale);
    this.proxyMesh.quaternion.copy(sourceMesh.quaternion);
    mainScene.add(this.proxyMesh);
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
      throw new Error('[PlaneComposer] dispose 済みのインスタンスでは addEffect() できません。');
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

  private enterBypass(): void {
    if (this._bypassed) return;
    this.mainScene.add(this.sourceMesh);
    this.proxyMesh.visible = false;
    this._bypassed = true;
  }

  private exitBypass(): void {
    if (!this._bypassed) return;
    this.mainScene.remove(this.sourceMesh);
    this.proxyMesh.visible = true;
    this._bypassed = false;
  }

  render(): void {
    if (this._disposed) return;
    if (!this.sourceMesh.visible) {
      this.proxyMesh.visible = false;
      return;
    }

    let activeCount = 0;
    for (const p of this.passes) if (p.enabled) activeCount++;
    if (activeCount === 0) {
      this.enterBypass();
      return;
    }

    this.exitBypass();

    this.proxyMesh.visible = true;
    this.proxyMesh.position.copy(this.sourceMesh.position);
    this.proxyMesh.scale.copy(this.sourceMesh.scale);
    this.proxyMesh.quaternion.copy(this.sourceMesh.quaternion);
    this.localMesh.scale.copy(this.sourceMesh.scale);

    this.renderer.setRenderTarget(this.targetA);
    this.renderer.render(this.localScene, this.localCamera);

    let read = this.targetA;
    let write = this.targetB;

    for (const pass of this.passes) {
      if (!pass.enabled) continue;
      pass.material.uniforms['tDiffuse'].value = read.texture;
      this.postMesh.material = pass.material;
      this.renderer.setRenderTarget(write);
      this.renderer.render(this.postScene, this.postCamera);

      const tmp = read;
      read = write;
      write = tmp;
    }

    this.proxyMaterial.map = read.texture;
    this.renderer.setRenderTarget(null);
  }

  resize(width: number, height: number): void {
    if (this._disposed) return;
    const dpr = this.renderer.getPixelRatio();
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));

    this.targetA.setSize(w, h);
    this.targetB.setSize(w, h);

    this.localCamera.left = -width / 2;
    this.localCamera.right = width / 2;
    this.localCamera.top = height / 2;
    this.localCamera.bottom = -height / 2;
    this.localCamera.updateProjectionMatrix();
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this.mainScene.remove(this.proxyMesh);
    if (!this._bypassed) {
      this.mainScene.add(this.sourceMesh);
    }
    this._bypassed = false;

    this.targetA.dispose();
    this.targetB.dispose();
    this.postGeo.dispose();
    this.postMeshDefaultMaterial.dispose();
    this.proxyGeo.dispose();
    this.proxyMaterial.dispose();
    for (const pass of this.passes) {
      pass.material.dispose();
    }
    this.passes = [];
  }
}
