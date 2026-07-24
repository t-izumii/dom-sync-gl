import * as THREE from 'three';
import type { Camera } from './Camera';
import type { DomPlane } from './DomPlane';

export type PointerType = 'mouse' | 'touch' | 'pen' | 'none';

export class PointerController {
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: Camera;
  private readonly planeMeshes: THREE.Mesh[];
  private readonly planeByMesh: Map<THREE.Mesh, DomPlane>;
  private readonly planes: DomPlane[];

  private readonly mouse = new THREE.Vector2(0.5, 0.5);
  private readonly prevMouse = new THREE.Vector2(0.5, 0.5);
  private readonly mouseDeltaBuf = new THREE.Vector2();
  private readonly ndcBuf = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  // Raycaster.intersectObjects は Object3D.visible を除外しないため、
  // 可視 mesh だけを詰め直して渡すための使い回しバッファ。
  private readonly visibleMeshBuf: THREE.Mesh[] = [];
  private hoveredPlane: DomPlane | null = null;

  private active = false;
  private activePointerId: number | null = null;
  private pointerType: PointerType = 'none';
  private canvasRect: DOMRect | null = null;
  private enabled = false;
  private pointerAbort: AbortController | null = null;

  constructor(opts: {
    canvas: HTMLCanvasElement;
    camera: Camera;

    planeMeshes: THREE.Mesh[];

    planeByMesh: Map<THREE.Mesh, DomPlane>;

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

  getMouseDelta(): THREE.Vector2 {
    return this.mouseDeltaBuf.copy(this.mouse).sub(this.prevMouse);
  }

  isPointerActive(): boolean {
    return this.active;
  }

  getPointerType(): PointerType {
    return this.pointerType;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  invalidateRect = (): void => {
    this.canvasRect = null;
  };

  private getCanvasRect(): DOMRect {
    if (!this.canvasRect) {
      this.canvasRect = this.canvas.getBoundingClientRect();
    }
    return this.canvasRect;
  }

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

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      if (this.pointerAbort) return;
      this.pointerAbort = new AbortController();
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
      const planes = this.planes;
      for (let i = 0, n = planes.length; i < n; i++) {
        if (planes[i].element === null) {
          planes[i].setHoverInfo(false, null);
        }
      }
    }
  }

  private isTouchLike(event: PointerEvent): boolean {
    return event.pointerType === 'touch' || event.pointerType === 'pen';
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (this.isTouchLike(event)) {

      if (event.pointerId !== this.activePointerId) return;
      this.active = this.applyPosition(event.clientX, event.clientY);
    } else {

      this.pointerType = 'mouse';
      this.active = this.applyPosition(event.clientX, event.clientY);
    }
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (this.isTouchLike(event)) {
      if (this.activePointerId !== null) return;
      const inside = this.applyPosition(event.clientX, event.clientY);
      if (!inside) return;
      this.activePointerId = event.pointerId;
      this.pointerType = event.pointerType === 'pen' ? 'pen' : 'touch';
      this.active = true;

      this.prevMouse.copy(this.mouse);
    } else {

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

  private releasePrimary(event: PointerEvent): void {
    if (event.pointerId === this.activePointerId) {
      this.activePointerId = null;
      this.active = false;
      this.pointerType = 'none';
    }
  }

  update(): void {
    if (!this.enabled) return;

    this.updateFullscreenHover();

    if (this.planeMeshes.length === 0) return;

    // hover 中の plane が非表示になると raycast 対象から外れ、通常経路では
    // 二度と hover 解除されないため、先にここで解除する。
    if (this.hoveredPlane && !this.hoveredPlane.isVisible) {
      this.hoveredPlane.setHoverInfo(false, null);
      this.hoveredPlane = null;
    }

    if (!this.active) {
      if (this.hoveredPlane) {
        this.hoveredPlane.setHoverInfo(false, null);
        this.hoveredPlane = null;
      }
      return;
    }

    const targets = this.visibleMeshBuf;
    targets.length = 0;
    const meshes = this.planeMeshes;
    for (let i = 0, n = meshes.length; i < n; i++) {
      if (meshes[i].visible) targets.push(meshes[i]);
    }

    this.ndcBuf.set(this.mouse.x * 2 - 1, this.mouse.y * 2 - 1);
    this.raycaster.setFromCamera(this.ndcBuf, this.camera.instance);
    const intersects = this.raycaster.intersectObjects(targets, false);

    if (intersects.length > 0) {
      const intersect = intersects[0];

      if (intersect.uv) {
        const hitMesh = intersect.object as THREE.Mesh;
        const plane = this.planeByMesh.get(hitMesh);
        if (plane && plane.isVisible) {

          if (this.hoveredPlane && this.hoveredPlane !== plane) {
            this.hoveredPlane.setHoverInfo(false, null);
          }
          plane.setHoverInfo(true, intersect.uv);
          this.hoveredPlane = plane;
          return;
        }
      }
    }

    if (this.hoveredPlane) {
      this.hoveredPlane.setHoverInfo(false, null);
      this.hoveredPlane = null;
    }
  }

  private updateFullscreenHover(): void {
    const planes = this.planes;
    for (let i = 0, n = planes.length; i < n; i++) {
      const plane = planes[i];
      if (plane.element === null) {
        plane.setHoverInfo(this.active, this.mouse);
      }
    }
  }

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
