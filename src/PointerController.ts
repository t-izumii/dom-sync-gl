import * as THREE from 'three';
import type { Camera } from './Camera';
import type { DomPlane } from './DomPlane';

/** 直近に処理したポインタの種別。`getPointerType()` で公開する（GLSL には流さない）。 */
export type PointerType = 'mouse' | 'touch' | 'pen' | 'none';

/**
 * canvas 上のポインタ入力（マウス / タッチ / ペン）と hover(raycast) を担うコントローラ。
 *
 * **Pointer Events に一本化**している（旧実装は `mousemove` のみ）。`pointermove` /
 * `pointerdown` / `pointerup` / `pointercancel` を listen し、マウス・タッチ・ペンを
 * **単一の単点パイプライン**（`mouse` UV + `active`）へ統合する。これにより既存シェーダーは
 * 無改修でタッチ対応になる（同じ `uMouseUV` / `uIsHovered` / `uMouse` / `uHover` に値が流れる）。
 *
 * 設計の肝:
 * - **入力と uniform 更新の分離**: `onPointer*` は **座標と active フラグだけ**更新する
 *   （uniform は書かない）。hover 判定（raycaster → `setHoverInfo`）は `update()` で行い、
 *   rAF tick 内から呼ぶことで paint と同期させ、非同期発火によるちらつきを防ぐ。
 * - **active の意味**: マウス/ペン hover = canvas 内に居るか。タッチ = 指が down 中かつ canvas 内。
 *   タッチには hover 概念が無いので「触れている間だけ active」とし、`uIsHovered`/`uHover` に流す。
 * - **単点保証**: 最初に canvas 上へ触れた pointer を主点として捕捉し、離す（up/cancel）まで
 *   2 本目以降の指は無視する。
 * - **スクロール非阻害**: 全リスナーは `{ passive: true }` で `preventDefault` しない。
 *   RafScroll / ScrollSync の慣性スクロールを一切妨げない。
 *
 * raycast 対象（`planeMeshes`）と mesh→plane 逆引き用の `planeByMesh` は DomSyncGL が
 * createPlane/removePlane で出し入れする **live 参照**を共有する。
 */
export class PointerController {
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: Camera;
  private readonly planeMeshes: THREE.Mesh[];
  private readonly planeByMesh: Map<THREE.Mesh, DomPlane>;
  /**
   * 全 DomPlane の live 配列参照（DomSyncGL 所有）。フルスクリーン plane（element 無し）の
   * hover uniform を毎フレ流すために走査する。raycast 対象（planeMeshes）には背景 plane を
   * 入れないので、こちらで element===null を拾って直接 setHoverInfo する。
   */
  private readonly planes: DomPlane[];

  private readonly mouse = new THREE.Vector2(0.5, 0.5);
  private readonly prevMouse = new THREE.Vector2(0.5, 0.5);
  /** getMouseDelta の戻り値スクラッチ（毎フレ clone を避ける）。 */
  private readonly mouseDeltaBuf = new THREE.Vector2();
  /** raycaster 用 NDC バッファ（毎フレ allocate を避ける）。 */
  private readonly ndcBuf = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private hoveredPlane: DomPlane | null = null;

  /**
   * ポインタが「有効」か。mouse/pen は canvas 内に居るか、touch は指が down 中かつ canvas 内。
   * `update()` の raycast 実行可否と、`uIsHovered`/`uHover` の値に使う。
   */
  private active = false;
  /**
   * 主点として捕捉中の pointerId（touch/pen のみ。未捕捉は null）。
   * 単点保証のため、この id 以外の touch/pen は無視する。mouse は常に主点扱い（id 管理しない）。
   */
  private activePointerId: number | null = null;
  /** 直近に処理したポインタ種別。 */
  private pointerType: PointerType = 'none';
  /**
   * canvas viewport rect のキャッシュ。pointermove ごとに getBoundingClientRect を呼ぶと
   * layout 強制が走るため、resize / (ScrollSync 無効時の) scroll で invalidate する形にする。
   */
  private canvasRect: DOMRect | null = null;
  private enabled = false;
  /** pointer listener 群の AbortController。動的 detach 用に独立して持つ。 */
  private pointerAbort: AbortController | null = null;

  constructor(opts: {
    canvas: HTMLCanvasElement;
    camera: Camera;
    /** raycast 対象 mesh の live 配列参照（DomSyncGL 所有）。 */
    planeMeshes: THREE.Mesh[];
    /** mesh → DomPlane 逆引き用の live Map 参照（DomSyncGL 所有）。 */
    planeByMesh: Map<THREE.Mesh, DomPlane>;
    /** 全 DomPlane の live 配列参照（DomSyncGL 所有）。フルスクリーン plane の hover に使う。 */
    planes: DomPlane[];
  }) {
    this.canvas = opts.canvas;
    this.camera = opts.camera;
    this.planeMeshes = opts.planeMeshes;
    this.planeByMesh = opts.planeByMesh;
    this.planes = opts.planes;
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

  /** ポインタが有効か（mouse/pen: canvas 内 / touch: 指 down 中かつ canvas 内）。 */
  isPointerActive(): boolean {
    return this.active;
  }

  /** 直近に処理したポインタ種別（'mouse' | 'touch' | 'pen' | 'none'）。 */
  getPointerType(): PointerType {
    return this.pointerType;
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
   * client 座標から canvas UV(0..1, Y-up) を算出して `mouse` に書き、canvas 内か返す。
   * canvas 外のときは `mouse` を更新しない（最後の内側位置を据え置く）。
   */
  private applyPosition(clientX: number, clientY: number): boolean {
    const rect = this.getCanvasRect();
    const isInside =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;
    if (isInside) {
      this.mouse.x = (clientX - rect.left) / rect.width;
      this.mouse.y = 1.0 - (clientY - rect.top) / rect.height;
    }
    return isInside;
  }

  /**
   * pointer tracking の動的 ON/OFF。
   * - true: 未 attach なら pointer listener 群を追加する
   * - false: attach 済みなら detach する（hover も解除）
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      if (this.pointerAbort) return; // すでに attach 済み
      this.pointerAbort = new AbortController();
      // 全リスナー passive。座標を読むだけで preventDefault しない＝スクロールを阻害しない。
      const opts: AddEventListenerOptions = {
        signal: this.pointerAbort.signal,
        passive: true,
      };
      window.addEventListener('pointermove', this.onPointerMove, opts);
      window.addEventListener('pointerdown', this.onPointerDown, opts);
      window.addEventListener('pointerup', this.onPointerUp, opts);
      window.addEventListener('pointercancel', this.onPointerCancel, opts);
    } else {
      this.pointerAbort?.abort();
      this.pointerAbort = null;
      this.active = false;
      this.activePointerId = null;
      this.pointerType = 'none';
      if (this.hoveredPlane) {
        this.hoveredPlane.setHoverInfo(false, null);
        this.hoveredPlane = null;
      }
      // フルスクリーン plane の hover も解除（disable 中は update() が早期 return するため）。
      const planes = this.planes;
      for (let i = 0, n = planes.length; i < n; i++) {
        if (planes[i].element === null) {
          planes[i].setHoverInfo(false, null);
        }
      }
    }
  }

  /** touch / pen か（= 指 down が active の前提になる種別）。 */
  private isTouchLike(event: PointerEvent): boolean {
    return event.pointerType === 'touch' || event.pointerType === 'pen';
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (this.isTouchLike(event)) {
      // 主点のみ追従（単点保証）。down 中だけ pointermove が来る。
      if (event.pointerId !== this.activePointerId) return;
      this.active = this.applyPosition(event.clientX, event.clientY);
    } else {
      // mouse/pen hover: ボタン不要。canvas 内外で active を決める（旧 onMouseMove と等価）。
      this.pointerType = 'mouse';
      this.active = this.applyPosition(event.clientX, event.clientY);
    }
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (this.isTouchLike(event)) {
      if (this.activePointerId !== null) return; // 既に主点あり → 2 本目以降は無視
      const inside = this.applyPosition(event.clientX, event.clientY);
      if (!inside) return; // canvas 外で始まった指は主点にしない
      this.activePointerId = event.pointerId;
      this.pointerType = event.pointerType === 'pen' ? 'pen' : 'touch';
      this.active = true;
      // 初フレの巨大 delta（fluid 等の force スパイク）を防ぐため prev を現在地にスナップ。
      this.prevMouse.copy(this.mouse);
    } else {
      // mouse: down は hover モデルに影響しない（位置だけ更新）。
      this.pointerType = 'mouse';
      this.active = this.applyPosition(event.clientX, event.clientY);
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.releasePrimary(event);
  };

  private onPointerCancel = (event: PointerEvent): void => {
    this.releasePrimary(event);
  };

  /** 主点 touch/pen が離れたら active を落とす。mouse の up は無視（hover は inside 駆動）。 */
  private releasePrimary(event: PointerEvent): void {
    if (event.pointerId === this.activePointerId) {
      this.activePointerId = null;
      this.active = false;
      this.pointerType = 'none';
    }
  }

  /**
   * rAF tick 内で呼ぶ。最新の pointer 位置で raycaster を投げ、hover 中の plane を判定して
   * `setHoverInfo`（uMouseUV / uIsHovered）を更新する。入力イベントから切り離すことで
   * 全 plane の uniform が 1 tick = 1 確定値で揃い、paint と同期する。
   */
  update(): void {
    if (!this.enabled) return;

    // フルスクリーン plane（element 無し = canvas 全面の背景）は raycast に入れない
    // （単一勝者の raycast だと DOM-locked plane と hover を奪い合う）。代わりに毎フレ
    // global pointer UV と active を直接流し、背景シェーダーでも uMouseUV / uIsHovered を
    // DOM-locked plane と同じ感覚で使えるようにする。
    this.updateFullscreenHover();

    if (this.planeMeshes.length === 0) return;

    // 非 active（canvas 外 / 指を離した）なら hover を解除
    if (!this.active) {
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

  /**
   * フルスクリーン plane（element 無し）の hover uniform を更新する。canvas 全面を覆うので
   * raycast せず、global pointer UV（`this.mouse`）と active（`this.active`）をそのまま
   * `setHoverInfo` に流す。これで背景シェーダーでも `uMouseUV` / `uIsHovered` が使える。
   */
  private updateFullscreenHover(): void {
    const planes = this.planes;
    for (let i = 0, n = planes.length; i < n; i++) {
      const plane = planes[i];
      if (plane.element === null) {
        plane.setHoverInfo(this.active, this.mouse);
      }
    }
  }

  /** フレーム末尾で prev に current を同期する。 */
  endFrame(): void {
    this.prevMouse.copy(this.mouse);
  }

  destroy(): void {
    this.pointerAbort?.abort();
    this.pointerAbort = null;
    this.active = false;
    this.activePointerId = null;
    this.pointerType = 'none';
    this.hoveredPlane = null;
    this.canvasRect = null;
  }
}
