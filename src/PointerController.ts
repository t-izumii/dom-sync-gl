import * as THREE from 'three';
import type { Camera } from './Camera';
import type { DomPlane } from './DomPlane';

/**
 * canvas 上のマウス入力と hover(raycast) を担うコントローラ。
 *
 * 設計の肝は「mousemove と uniform 更新の分離」:
 * - `onMouseMove` は **マウス座標と canvas 内外フラグだけ** 更新する（uniform は書かない）。
 * - hover 判定（raycaster → `setHoverInfo` = uMouseUV / uIsHovered 更新）は `update()` で
 *   行い、これを rAF tick 内から呼ぶことで paint と同期させ、mousemove 非同期発火による
 *   uMouseUV のちらつきを防ぐ。
 *
 * raycast 対象（`planeMeshes`）と mesh→plane 逆引き用の `planeByMesh` は WebGLApp が
 * createPlane/removePlane で出し入れする **live 参照**を共有する。
 */
export class PointerController {
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: Camera;
  private readonly planeMeshes: THREE.Mesh[];
  private readonly planeByMesh: Map<THREE.Mesh, DomPlane>;

  private readonly mouse = new THREE.Vector2(0.5, 0.5);
  private readonly prevMouse = new THREE.Vector2(0.5, 0.5);
  /** getMouseDelta の戻り値スクラッチ（毎フレ clone を避ける）。 */
  private readonly mouseDeltaBuf = new THREE.Vector2();
  /** raycaster 用 NDC バッファ（毎フレ allocate を避ける）。 */
  private readonly ndcBuf = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private hoveredPlane: DomPlane | null = null;

  /** マウスが canvas 矩形の内側に居るか。mousemove で更新し update() の raycast 実行可否に使う。 */
  private mouseInside = false;
  /**
   * canvas viewport rect のキャッシュ。mousemove ごとに getBoundingClientRect を呼ぶと
   * layout 強制が走るため、resize / (ScrollSync 無効時の) scroll で invalidate する形にする。
   */
  private canvasRect: DOMRect | null = null;
  private enabled = false;
  /** mousemove listener 専用の AbortController。動的 detach 用に独立して持つ。 */
  private mouseAbort: AbortController | null = null;

  constructor(opts: {
    canvas: HTMLCanvasElement;
    camera: Camera;
    /** raycast 対象 mesh の live 配列参照（WebGLApp 所有）。 */
    planeMeshes: THREE.Mesh[];
    /** mesh → DomPlane 逆引き用の live Map 参照（WebGLApp 所有）。 */
    planeByMesh: Map<THREE.Mesh, DomPlane>;
  }) {
    this.canvas = opts.canvas;
    this.camera = opts.camera;
    this.planeMeshes = opts.planeMeshes;
    this.planeByMesh = opts.planeByMesh;
  }

  getMouse(): THREE.Vector2 {
    return this.mouse;
  }

  getPrevMouse(): THREE.Vector2 {
    return this.prevMouse;
  }

  /** current - prev。内部スクラッチを使い回すので保持したい場合は呼び出し側で clone する。 */
  getMouseDelta(): THREE.Vector2 {
    return this.mouseDeltaBuf.copy(this.mouse).sub(this.prevMouse);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** canvas rect キャッシュを無効化（resize / scroll 時に呼ぶ）。 */
  invalidateRect = (): void => {
    this.canvasRect = null;
  };

  private getCanvasRect(): DOMRect {
    if (!this.canvasRect) {
      this.canvasRect = this.canvas.getBoundingClientRect();
    }
    return this.canvasRect;
  }

  /**
   * mousemove tracking の動的 ON/OFF。
   * - true: 未 attach なら mousemove listener を追加する
   * - false: attach 済みなら detach する（hover も解除）
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      if (this.mouseAbort) return; // すでに attach 済み
      this.mouseAbort = new AbortController();
      window.addEventListener('mousemove', this.onMouseMove, {
        signal: this.mouseAbort.signal,
      });
    } else {
      this.mouseAbort?.abort();
      this.mouseAbort = null;
      this.mouseInside = false;
      if (this.hoveredPlane) {
        this.hoveredPlane.setHoverInfo(false, null);
        this.hoveredPlane = null;
      }
    }
  }

  private onMouseMove = (event: MouseEvent): void => {
    const rect = this.getCanvasRect();

    const isInside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    this.mouseInside = isInside;
    if (!isInside) return;

    this.mouse.x = (event.clientX - rect.left) / rect.width;
    this.mouse.y = 1.0 - (event.clientY - rect.top) / rect.height;
  };

  /**
   * rAF tick 内で呼ぶ。最新の mouse で raycaster を投げ、hover 中の plane を判定して
   * `setHoverInfo`（uMouseUV / uIsHovered）を更新する。mousemove から切り離すことで
   * 全 plane の uniform が 1 tick = 1 確定値で揃い、paint と同期する。
   */
  update(): void {
    if (!this.enabled) return;
    if (this.planeMeshes.length === 0) return;

    // canvas 外なら hover を解除
    if (!this.mouseInside) {
      if (this.hoveredPlane) {
        this.hoveredPlane.setHoverInfo(false, null);
        this.hoveredPlane = null;
      }
      return;
    }

    this.ndcBuf.set(this.mouse.x * 2 - 1, this.mouse.y * 2 - 1);
    this.raycaster.setFromCamera(this.ndcBuf, this.camera.instance);
    const intersects = this.raycaster.intersectObjects(this.planeMeshes, false);

    if (intersects.length > 0) {
      const intersect = intersects[0];
      // planeMeshes は planes と index 1:1 対応していない（背景 plane は meshes に入らない）
      // ため、mesh から対応する DomPlane を Map で O(1) 逆引きする。
      if (intersect.uv) {
        const hitMesh = intersect.object as THREE.Mesh;
        const plane = this.planeByMesh.get(hitMesh);
        if (plane) {
          // 別の plane に hover が移った時のみ前 plane を false 化（uniform 書き込みを減らす）。
          if (this.hoveredPlane && this.hoveredPlane !== plane) {
            this.hoveredPlane.setHoverInfo(false, null);
          }
          plane.setHoverInfo(true, intersect.uv);
          this.hoveredPlane = plane;
          return;
        }
      }
    }

    // どの plane にも当たっていない: 既存 hover があれば解除
    if (this.hoveredPlane) {
      this.hoveredPlane.setHoverInfo(false, null);
      this.hoveredPlane = null;
    }
  }

  /** フレーム末尾で prev に current を同期する。 */
  endFrame(): void {
    this.prevMouse.copy(this.mouse);
  }

  destroy(): void {
    this.mouseAbort?.abort();
    this.mouseAbort = null;
    this.hoveredPlane = null;
    this.canvasRect = null;
  }
}
