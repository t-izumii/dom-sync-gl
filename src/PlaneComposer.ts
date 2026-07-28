import * as THREE from 'three/webgpu';
import { texture, uv } from 'three/tsl';
import type { TextureNode } from 'three/webgpu';
import type { EffectOptions, EffectTarget } from './EffectComposer';
import { EffectPass } from './EffectComposer';

export class PlaneComposer implements EffectTarget {
  private renderer: THREE.WebGPURenderer;
  private sourceMesh: THREE.Mesh;
  private passes: EffectPass[] = [];

  private targetA: THREE.RenderTarget;
  private targetB: THREE.RenderTarget;

  private localScene: THREE.Scene;
  private localCamera: THREE.OrthographicCamera;
  private localMesh: THREE.Mesh;

  // fullscreen pass の描画は自前の ortho カメラではなく QuadMesh に任せる。
  // 自前 ortho の clip 空間 z は WebGL([-1,1]) と WebGPU([0,1]) で異なり
  // 描画が欠けうるため、両バックエンドを吸収する公式ヘルパーを使う。
  private quad: THREE.QuadMesh;

  // sourceMesh を Object3D として mainScene に残したまま、effect 有効時だけ
  // material をこれに差し替えて合成結果を表示する（renderOrder / layers /
  // frustumCulled / 親子関係を proxy へ移し替えず自動的に維持するため）。
  // RT は premultiplied alpha なので premultipliedAlpha:true で合成し alpha の
  // 再乗算を防ぐ。depthTest / depthWrite / side は originalMaterial の値を毎
  // render で同期してユーザー設定を維持する。カスタム blending は premultiplied
  // 合成と両立しないため同期しない。
  private readonly displayMaterial: THREE.MeshBasicNodeMaterial;
  // 表示する ping-pong 結果 RT を毎フレーム差し替えるためのテクスチャノード。
  private readonly displayTexture: TextureNode;
  // effect 有効時に差し替える前の material。bypass / dispose で戻す。
  private readonly originalMaterial: THREE.Material;

  private _disposed: boolean = false;

  constructor(
    renderer: THREE.WebGPURenderer,
    sourceMesh: THREE.Mesh,
    width: number,
    height: number,
  ) {
    this.renderer = renderer;
    this.sourceMesh = sourceMesh;
    this.originalMaterial = sourceMesh.material as THREE.Material;

    const dpr = renderer.getPixelRatio();
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));

    const rtOptions: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      stencilBuffer: false,
      // fullscreen quad と単一 plane しか描かないため depth は不要。VRAM を節約する。
      depthBuffer: false,
    };
    this.targetA = new THREE.RenderTarget(w, h, rtOptions);
    this.targetB = new THREE.RenderTarget(w, h, rtOptions);

    this.localScene = new THREE.Scene();
    this.localCamera = new THREE.OrthographicCamera(
      -width / 2, width / 2, height / 2, -height / 2, 0.1, 10,
    );
    this.localCamera.position.set(0, 0, 1);

    this.localMesh = new THREE.Mesh(sourceMesh.geometry, sourceMesh.material);
    this.localMesh.position.set(0, 0, 0);
    this.localMesh.scale.copy(sourceMesh.scale);
    this.localScene.add(this.localMesh);

    this.quad = new THREE.QuadMesh();

    this.displayTexture = texture(this.targetA.texture);
    this.displayMaterial = new THREE.MeshBasicNodeMaterial();
    this.displayMaterial.colorNode = this.displayTexture;
    this.displayMaterial.transparent = true;
    this.displayMaterial.premultipliedAlpha = true;
  }

  /**
   * fullscreen pass を追加する。
   *
   * alpha 契約: 中間 RenderTarget と inputTexture は premultiplied alpha。各 pass は
   * 前段の結果を丸ごと置き換えるため NoBlending で素通しする（NormalBlending だと
   * alpha が pass ごとに再乗算され透明部が暗くなる）。
   *
   * material の colorNode 選択理由は EffectComposer.addEffect() と同じ
   * （fragmentNode は画面出力時の色空間変換まで素通ししてしまう）。
   */
  addEffect(options: EffectOptions): EffectPass {
    if (this._disposed) {
      throw new Error('[PlaneComposer] dispose 済みのインスタンスでは addEffect() できません。');
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

  render(): void {
    if (this._disposed) return;
    // sourceMesh 自体が非表示なら描画しない（新方式では隠す proxy が無い）。
    if (!this.sourceMesh.visible) return;

    let activeCount = 0;
    for (const p of this.passes) if (p.enabled) activeCount++;
    if (activeCount === 0) {
      this.sourceMesh.material = this.originalMaterial;
      return;
    }

    // 外部がバインドした RenderTarget を壊さないよう保存し、末尾で復元する。
    const prevTarget = this.renderer.getRenderTarget();

    this.localMesh.scale.copy(this.sourceMesh.scale);
    this.syncDisplayMaterialState();

    this.renderer.setRenderTarget(this.targetA);
    this.renderer.render(this.localScene, this.localCamera);

    let read = this.targetA;
    let write = this.targetB;

    for (const pass of this.passes) {
      if (!pass.enabled) continue;
      pass.inputTexture.value = read.texture;
      this.quad.material = pass.material;
      this.renderer.setRenderTarget(write);
      this.quad.render(this.renderer);

      const tmp = read;
      read = write;
      write = tmp;
    }

    this.displayTexture.value = read.texture;
    this.sourceMesh.material = this.displayMaterial;
    this.renderer.setRenderTarget(prevTarget);
  }

  // material レベルの描画状態を originalMaterial から displayMaterial へ写す。
  // Why は displayMaterial の宣言部を参照。
  private syncDisplayMaterialState(): void {
    this.displayMaterial.depthTest = this.originalMaterial.depthTest;
    this.displayMaterial.depthWrite = this.originalMaterial.depthWrite;
    this.displayMaterial.side = this.originalMaterial.side;
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

    // 呼び出し元が引き続き扱えるよう sourceMesh の material を元へ戻す。
    this.sourceMesh.material = this.originalMaterial;

    this.targetA.dispose();
    this.targetB.dispose();
    // QuadMesh の geometry は全インスタンス共有のため dispose してはいけない。
    this.displayMaterial.dispose();
    for (const pass of this.passes) {
      pass.material.dispose();
    }
    this.passes = [];
  }
}
