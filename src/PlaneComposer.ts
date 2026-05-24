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

/**
 * DomPlane 単体にエフェクトチェーンを適用するクラス。
 *
 * render flow:
 *   plane.mesh (local scene) → targetA
 *   pass1: A → B
 *   pass2: B → A
 *   ...
 *   final target → proxyMesh.material.map (main scene に表示)
 *
 * plane.mesh はコンストラクト時に main scene から取り出し local scene へ移動。
 * proxyMesh がその位置に差し替わり、エフェクト適用後のテクスチャを表示する。
 *
 * **制約・落とし穴**:
 * - main scene に置く `proxyMesh` は固定で `MeshBasicMaterial({ transparent: true })`。
 *   `DomPlane` 本体の `ShaderMaterial` の depthWrite / depthTest / blending 設定は反映されない。
 *   不透明背景のシーンに混ぜると z 順がおかしく見えることがある（透過レイヤ前提のデザイン推奨）。
 * - `localMesh` は `sourceMesh.geometry` / `material` を**共有**して描画する。
 *   `DomPlane.setHoverInfo()` 等で uniform を更新すれば自動でこちらにも反映される。
 *   ただし raycast の hit ターゲットは main scene にある `proxyMesh`（material が違う）に
 *   なるため、`uv` 結果は plane の物理位置に対して正しく出る。
 * - `addEffect` を 0 回しか呼ばないケースでも `render()` は targetA 経由でプロキシに焼く。
 *   この場合 proxy はエフェクトなしの sourceMesh の見た目をそのまま表示する。
 */
export class PlaneComposer implements EffectTarget {
  private renderer: THREE.WebGLRenderer;
  private sourceMesh: THREE.Mesh;
  private passes: EffectPass[] = [];

  private targetA: THREE.WebGLRenderTarget;
  private targetB: THREE.WebGLRenderTarget;

  // plane の内容を FBO に焼くための専用シーン
  private localScene: THREE.Scene;
  private localCamera: THREE.OrthographicCamera;
  private localMesh: THREE.Mesh;

  // エフェクトパス適用用シーン
  private postScene: THREE.Scene;
  private postCamera: THREE.OrthographicCamera;
  private postMesh: THREE.Mesh;
  private postGeo: THREE.PlaneGeometry;

  // main scene に表示するプロキシ
  private proxyMesh: THREE.Mesh;
  private proxyMaterial: THREE.MeshBasicMaterial;
  private proxyGeo: THREE.PlaneGeometry;
  private mainScene: THREE.Scene;

  /**
   * 全 effect が enabled=false の時、PlaneComposer をスキップして sourceMesh を
   * 直接 main scene で描画する状態（bypass）。 fullscreen pass 1 回ぶんを丸ごと
   * 削減できる。effect が再度 enable された時は通常レンダリングに復帰する。
   */
  private _bypassed: boolean = false;
  /** dispose 済みフラグ。dispose 後の render / addEffect を no-op にする。 */
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

    // local scene: plane の mesh を正面から orthographic で撮る
    this.localScene = new THREE.Scene();
    this.localCamera = new THREE.OrthographicCamera(
      -width / 2, width / 2, height / 2, -height / 2, 0.1, 10,
    );
    this.localCamera.position.set(0, 0, 1);

    // sourceMesh と同じ geometry/material を共有するローカルレンダリング用メッシュ
    this.localMesh = new THREE.Mesh(sourceMesh.geometry, sourceMesh.material);
    this.localMesh.position.set(0, 0, 0);
    this.localMesh.scale.copy(sourceMesh.scale);
    this.localScene.add(this.localMesh);

    // post-process シーン（フルスクリーンクワッド）
    this.postScene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postGeo = new THREE.PlaneGeometry(2, 2);
    this.postMesh = new THREE.Mesh(this.postGeo);
    this.postScene.add(this.postMesh);

    // main scene から sourceMesh を外してプロキシに差し替え
    mainScene.remove(sourceMesh);

    this.proxyMaterial = new THREE.MeshBasicMaterial({
      map: this.targetA.texture,
      transparent: true,
    });
    this.proxyGeo = new THREE.PlaneGeometry(1, 1);
    this.proxyMesh = new THREE.Mesh(this.proxyGeo, this.proxyMaterial);
    this.proxyMesh.position.copy(sourceMesh.position);
    this.proxyMesh.scale.copy(sourceMesh.scale);
    this.proxyMesh.quaternion.copy(sourceMesh.quaternion);
    mainScene.add(this.proxyMesh);
  }

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
      transparent: true,
    });
    const pass = new EffectPass(material);
    this.passes.push(pass);
    return pass;
  }

  /**
   * 登録済みパスを 1 つ取り除いて material を dispose する。
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
   * bypass 状態に切り替える: sourceMesh を main scene に戻し proxyMesh を隠す。
   * 全 effect が disabled の時に呼ばれ、PlaneComposer.render の fullscreen pass を
   * まるごと省く (= 1 pass / 6.35M フラグメント分の節約)。
   */
  private enterBypass(): void {
    if (this._bypassed) return;
    this.mainScene.add(this.sourceMesh);
    this.proxyMesh.visible = false;
    this._bypassed = true;
  }

  /** bypass 状態から通常レンダリングへ復帰する。 */
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

    // 全 effect disabled なら main scene 直描画にバイパス
    // (sourceMesh が main scene にいる状態を維持し、PlaneComposer は no-op)
    let activeCount = 0;
    for (const p of this.passes) if (p.enabled) activeCount++;
    if (activeCount === 0) {
      this.enterBypass();
      return;
    }

    // active effect あり → bypass から復帰
    this.exitBypass();

    // sourceMesh の visibility/transform をプロキシに同期
    this.proxyMesh.visible = true;
    this.proxyMesh.position.copy(this.sourceMesh.position);
    this.proxyMesh.scale.copy(this.sourceMesh.scale);
    this.proxyMesh.quaternion.copy(this.sourceMesh.quaternion);
    this.localMesh.scale.copy(this.sourceMesh.scale);

    // 1. plane の内容を targetA に描画
    this.renderer.setRenderTarget(this.targetA);
    this.renderer.render(this.localScene, this.localCamera);

    // 2. エフェクトパスを pingpong で適用 (active なものだけ)
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

    // 最終結果をプロキシに反映。
    // `material.needsUpdate = true` を毎フレ呼ぶと three.js は version 衝突として
    // shader を recompile する。`map` の差し替えだけなら不要なので呼ばない。
    // （texture の中身の更新は Texture.needsUpdate のジョブで、ここでは別物。）
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
    // bypass 中なら sourceMesh は既に main scene にいる。THREE.Object3D.add は同一 parent でも
    // 内部で removeFromParent → push し直すため、children 配列の末尾に移動する
    // (= sortObjects=false 運用で描画順が変わる)。bypass 中はスキップする。
    this.mainScene.remove(this.proxyMesh);
    if (!this._bypassed) {
      this.mainScene.add(this.sourceMesh);
    }
    this._bypassed = false;

    this.targetA.dispose();
    this.targetB.dispose();
    this.postGeo.dispose();
    this.proxyGeo.dispose();
    this.proxyMaterial.dispose();
    for (const pass of this.passes) {
      pass.material.dispose();
    }
    this.passes = [];
  }
}
