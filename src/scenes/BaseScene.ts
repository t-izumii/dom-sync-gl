import * as THREE from "three";
import { Camera } from "../Camera";

/**
 * `BaseScene` — 自前の `THREE.Scene` + `Camera` を 1 組持つ、**自己完結したサブシーン**の
 * 抽象基底。`init` / `update(time, progress)` / `resize` / `dispose` のライフサイクルを定義する。
 *
 * ## 位置づけ（重要）
 * これは `WebGLApp`（`Core`）の**メインのデータフローには組み込まれていない**独立ユニットである。
 * DOM 要素にロックした plane（`DomPlane` / `Dom3DObject`）を 1 つの共有 scene/camera に並べる
 * 本流とは別系統で、「**DOM 同期を必要としない、独立した 3D シーンを 1 つの単位として扱いたい**」
 * ケース向けのオプトイン基底クラスである。`WebGLApp` は本クラスを内部で生成・駆動しないので、
 * 利用者が自分で継承し、自分の rAF / スクロール進捗から `update()` を呼んで駆動する。
 *
 * ## 想定ユースケース
 * - **シーン単位の差し替え / 切り替え**: ページ内の局面ごとに独立した scene を用意し、表示中の
 *   ものだけ `update()` する（イントロ → メイン等）。各 scene が自前の camera を持つので、
 *   カメラワークを互いに干渉させずに組める。
 * - **オフスクリーン / 別ターゲットへのレンダリング**: `scene` と `camera.instance` を
 *   `renderer.render(scene.scene, scene.camera.instance)` や RenderTarget に渡して、本体 canvas
 *   とは別の描画ユニットとして焼く。
 * - **スクロール / タイムライン進捗で駆動するシーケンス**: `update(time, progress)` の `progress`
 *   に 0〜1 の正規化進捗（スクロール率や GSAP timeline の進捗）を流し、time（経過秒）と組み合わせて
 *   アニメーションを進める。
 *
 * ## 座標系
 * 内包する {@link Camera} は「DOM 1px = WebGL 1unit」系（`position.z = rect.height / 2 / tan(fov/2)`）。
 * `resize()` で camera の aspect / 距離が `rect` から再計算される点も本流の `Camera` と同一。
 *
 * @example
 * ```ts
 * class IntroScene extends BaseScene {
 *   private mesh!: THREE.Mesh;
 *   init() {
 *     this.mesh = new THREE.Mesh(
 *       new THREE.PlaneGeometry(200, 200),
 *       new THREE.MeshBasicMaterial({ color: 0xff5a3c }),
 *     );
 *     this.scene.add(this.mesh);
 *   }
 *   update(time: number, progress: number) {
 *     this.mesh.rotation.z = time * 0.5;
 *     this.mesh.position.y = progress * 400; // progress=スクロール率 0〜1
 *   }
 *   dispose() {
 *     this.mesh.geometry.dispose();
 *     (this.mesh.material as THREE.Material).dispose();
 *   }
 * }
 *
 * const intro = new IntroScene(canvas.getBoundingClientRect());
 * intro.init();
 * // 利用者側の rAF ループで駆動する
 * function tick(t: number) {
 *   intro.update(t / 1000, window.scrollY / maxScroll);
 *   renderer.render(intro.scene, intro.camera.instance);
 *   requestAnimationFrame(tick);
 * }
 * ```
 */
export abstract class BaseScene {
  /** このサブシーン専用の THREE.Scene。継承側が `init()` で中身を add する。 */
  scene: THREE.Scene;
  /** このサブシーン専用のカメラ（「DOM 1px = WebGL 1unit」系）。 */
  camera: Camera;

  /** 現在の描画領域。`resize()` で更新され camera 再計算の入力になる。 */
  rect: DOMRect;

  constructor(rect: DOMRect) {
    this.scene = new THREE.Scene();
    this.camera = new Camera(rect);
    this.rect = rect;
  }

  /** シーン構築。mesh / light 等の生成と `scene.add` を行う。生成直後に 1 度呼ぶ。 */
  abstract init(): void;
  /**
   * 毎フレーム更新。
   * @param time 経過秒（利用者が clock 等から渡す）。
   * @param progress 0〜1 の正規化進捗（スクロール率 / timeline 進捗など）。
   */
  abstract update(time: number, progress: number): void;

  /** 描画領域変更時に呼ぶ。`rect` を差し替え camera の aspect / 距離を再計算する。 */
  resize(rect: DOMRect): void {
    this.rect = rect;
    this.camera.resize(rect);
  }

  /** 破棄時のクリーンアップ。geometry / material / texture の dispose は継承側で実装する。 */
  dispose(): void {}
}
