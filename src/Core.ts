import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type GUI from 'lil-gui';
import { Camera } from './Camera';
import { Light } from './Light';
import { DomPlane } from './DomPlane';
import { Dom3DObject } from './Dom3DObject';
import { ScrollSync } from './ScrollSync';
import { RafScroll } from './RafScroll';
import type { EffectLike } from './EffectComposer';
import type { ScrollSyncOptions } from './ScrollSync';
import type { RafScrollOptions } from './RafScroll';
import type { BaseEffect } from './effects/BaseEffect';
import { PointerController, type PointerType } from './PointerController';
import { EffectManager } from './EffectManager';
import { DevTools } from './DevTools';
import type {
  CreatePlaneOptions,
  Create3DObjectOptions,
  DomSyncGLOptions,
} from './types';

export class DomSyncGL {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: Camera;
  light: Light;
  controls: OrbitControls | null;
  updateCallbacks: (() => void)[];
  resizeCallbacks: (() => void)[];
  rect: DOMRect;
  domPlanes: DomPlane[];
  dom3DObjects: Dom3DObject[];
  clock: THREE.Clock;
  scrollSync: ScrollSync | null = null;
  private rafScroll: RafScroll | null = null;
  private options: DomSyncGLOptions;
  private rafId: number = 0;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private eventAbort: AbortController = new AbortController();
  private pointer!: PointerController;
  private effectManager!: EffectManager;
  private devTools!: DevTools;
  private readonly _scroll: { x: number; y: number } = { x: 0, y: 0 };
  private domPlaneMeshes: THREE.Mesh[] = [];
  private domPlaneByMesh: Map<THREE.Mesh, DomPlane> = new Map();
  private destroyed: boolean = false;

  constructor(selector: string | HTMLElement, options: DomSyncGLOptions = {}) {
    const element =
      typeof selector === 'string'
        ? document.querySelector(selector)
        : selector;
    if (!element) {
      throw new Error(`Container not found: ${selector}`);
    }
    this.container = element as HTMLElement;

    this.canvas = document.createElement('canvas');
    this.container.appendChild(this.canvas);

    this.rect = this.container.getBoundingClientRect();
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
    });
    this.camera = new Camera(this.rect);
    this.light = new Light(this.scene);
    this.controls = null;
    this.updateCallbacks = [];
    this.resizeCallbacks = [];
    this.domPlanes = [];
    this.dom3DObjects = [];
    this.clock = new THREE.Clock();
    this.options = { showGUI: false, ...options };

    this.options.enablePointerTracking =
      options.enablePointerTracking ?? options.enableMouseTracking ?? true;

    const showGUI = this.options.showGUI === true;
    this.devTools = new DevTools({
      showStats: !!options.showStats,
      statsParent: options.statsParent ?? document.body,
      showGUI,
      guiTitle: options.guiTitle ?? 'Effects',
      isDestroyed: () => this.destroyed,
    });
    this.effectManager = new EffectManager({
      renderer: this.renderer,
      showGUI,
      ensureGUI: () => this.devTools.ensureGUI(),
      isDestroyed: () => this.destroyed,
    });
    this.pointer = new PointerController({
      canvas: this.canvas,
      camera: this.camera,
      planeMeshes: this.domPlaneMeshes,
      planeByMesh: this.domPlaneByMesh,
      planes: this.domPlanes,
    });

    if (options.scrollSync) {
      const syncOptions: ScrollSyncOptions =
        typeof options.scrollSync === 'object' ? options.scrollSync : {};
      this.scrollSync = new ScrollSync(this.container, syncOptions);
      this.rect = this.scrollSync.logicalRect;
    }

    if (options.rafScroll) {
      const rafScrollOptions: RafScrollOptions =
        typeof options.rafScroll === 'object' ? options.rafScroll : {};
      this.rafScroll = new RafScroll({ ...rafScrollOptions, autoStart: false });
    }

    this.refreshScrollCache();

    this.init();

    this.devTools.loadStats();

    this.setupEventListeners();
    this.animate();
  }

  private init() {
    this.scene.background = null;

    this.renderer.setSize(this.rect.width, this.rect.height);
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, this.options.maxPixelRatio ?? 2),
    );
    this.camera.resize(this.rect);

    this.renderer.outputColorSpace =
      this.options.outputColorSpace ?? THREE.SRGBColorSpace;
  }

  getScene() {
    return this.scene;
  }

  getCamera() {
    return this.camera;
  }

  getRenderer() {
    return this.renderer;
  }

  getLight() {
    return this.light;
  }

  getViewPort() {
    return this.rect;
  }

  getMouse() {
    return this.pointer.getMouse();
  }

  getScroll(): Readonly<{ x: number; y: number }> {
    return this._scroll;
  }

  getRafScroll(): RafScroll | null {
    return this.rafScroll;
  }

  private refreshScrollCache(): void {
    this._scroll.x = window.scrollX;
    this._scroll.y = this.scrollSync
      ? ScrollSync.computeEffectiveScrollY()
      : window.scrollY;
  }

  getPrevMouse() {
    return this.pointer.getPrevMouse();
  }

  getMouseDelta() {
    return this.pointer.getMouseDelta();
  }

  isPointerActive(): boolean {
    return this.pointer.isPointerActive();
  }

  getPointerType(): PointerType {
    return this.pointer.getPointerType();
  }

  getScrollSync() {
    return this.scrollSync;
  }

  addObject(object: THREE.Object3D) {
    this.scene.add(object);
  }

  removeObject(object: THREE.Object3D) {
    this.scene.remove(object);
  }

  createPlane(
    selector: string | HTMLElement | null,
    options?: CreatePlaneOptions
  ) {
    if (this.destroyed) {
      throw new Error('[DomSyncGL] createPlane(): destroy 済みのインスタンスでは使えません。');
    }
    let element: HTMLElement | null = null;

    if (selector !== null && selector !== undefined) {
      element =
        typeof selector === 'string'
          ? (document.querySelector(selector) as HTMLElement)
          : selector;

      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }
    }

    const domPlane = new DomPlane(
      element,
      this.scene,
      this.rect,
      this._scroll,
      this.renderer,
      options,
      this.clock,
    );

    if (this.options.showGUI === true) {
      domPlane._setGuiProvider(() => this._ensureGUIAsync());
    }
    this.domPlanes.push(domPlane);

    if (element) {
      const mesh = domPlane.getMesh();
      this.domPlaneMeshes.push(mesh);
      this.domPlaneByMesh.set(mesh, domPlane);
    }

    return domPlane;
  }

  removePlane(domPlane: DomPlane) {
    if (this.destroyed) return;
    const index = this.domPlanes.indexOf(domPlane);
    if (index > -1) {
      this.domPlanes.splice(index, 1);
      const mesh = domPlane.getMesh();
      const meshIndex = this.domPlaneMeshes.indexOf(mesh);
      if (meshIndex > -1) this.domPlaneMeshes.splice(meshIndex, 1);
      this.domPlaneByMesh.delete(mesh);
      domPlane.destroy();
    }
  }

  create3DObject(
    selector: string | HTMLElement | null,
    options: Create3DObjectOptions,
  ) {
    if (this.destroyed) {
      throw new Error('[DomSyncGL] create3DObject(): destroy 済みのインスタンスでは使えません。');
    }
    let element: HTMLElement | null = null;

    if (selector !== null && selector !== undefined) {
      element =
        typeof selector === 'string'
          ? (document.querySelector(selector) as HTMLElement | null)
          : selector;
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }
    }

    const dom3DObject = new Dom3DObject(
      element,
      this.scene,
      this.rect,
      this._scroll,
      options,
    );
    this.dom3DObjects.push(dom3DObject);

    return dom3DObject;
  }

  remove3DObject(dom3DObject: Dom3DObject) {
    if (this.destroyed) return;
    const index = this.dom3DObjects.indexOf(dom3DObject);
    if (index > -1) {
      this.dom3DObjects.splice(index, 1);
      dom3DObject.destroy();
    }
  }

  addUpdateCallback(callback: () => void): () => void {
    if (this.destroyed) return () => {};
    this.updateCallbacks.push(callback);
    return () => {
      const index = this.updateCallbacks.indexOf(callback);
      if (index > -1) this.updateCallbacks.splice(index, 1);
    };
  }

  addResizeCallback(callback: () => void): () => void {
    if (this.destroyed) return () => {};
    this.resizeCallbacks.push(callback);
    return () => {
      const index = this.resizeCallbacks.indexOf(callback);
      if (index > -1) this.resizeCallbacks.splice(index, 1);
    };
  }

  enableOrbitControls() {
    if (this.destroyed) {
      throw new Error('[DomSyncGL] enableOrbitControls(): destroy 済みのインスタンスでは使えません。');
    }
    if (!this.controls) {
      if (this.scrollSync) {
        this.canvas.style.pointerEvents = 'auto';
      }
      this.controls = new OrbitControls(this.camera.instance, this.canvas);
    }
    return this.controls;
  }

  getControls() {
    return this.controls;
  }

  addEffect<T extends BaseEffect>(effect: T): T {
    if (this.destroyed) {
      throw new Error('[DomSyncGL] addEffect(): destroy 済みのインスタンスでは使えません。');
    }
    return this.effectManager.addEffect(effect, this.rect.width, this.rect.height);
  }

  _ensureGUIAsync(): Promise<GUI> {
    return this.devTools.ensureGUI();
  }

  getGUI(): GUI | null {
    return this.devTools.getGUI();
  }

  getGUIAsync(): Promise<GUI | null> {
    return this.devTools.getGUIAsync();
  }

  setPostEffect(postEffect: EffectLike): void {
    if (this.destroyed) {
      throw new Error('[DomSyncGL] setPostEffect(): destroy 済みのインスタンスでは使えません。');
    }
    this.effectManager.setPostEffect(postEffect);
  }

  removeEffect(effect: BaseEffect): boolean {
    if (this.destroyed) return false;
    return this.effectManager.removeEffect(effect);
  }

  clearEffects(): void {
    if (this.destroyed) return;
    this.effectManager.clearEffects();
  }

  private setupEventListeners() {
    const signal = this.eventAbort.signal;

    window.addEventListener(
      'resize',
      () => {
        if (this.resizeTimer) clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => this.onResize(), 100);
      },
      { signal },
    );

    if (!this.scrollSync) {
      window.addEventListener('scroll', this.pointer.invalidateRect, {
        signal,
        passive: true,
      });
    }
    if (this.options.enablePointerTracking) {
      this.setPointerTrackingEnabled(true);
    }
  }

  setPointerTrackingEnabled(enabled: boolean): void {
    if (this.destroyed) return;
    this.options.enablePointerTracking = enabled;
    this.options.enableMouseTracking = enabled;
    this.pointer.setEnabled(enabled);
  }

  setMouseTrackingEnabled(enabled: boolean): void {
    this.setPointerTrackingEnabled(enabled);
  }

  private onResize() {

    this.pointer.invalidateRect();
    this.refreshScrollCache();

    if (this.scrollSync) {

      this.scrollSync.updateSize();
      this.rect = this.scrollSync.logicalRect;
    } else {
      this.rect = this.container.getBoundingClientRect();
    }
    if (this.rect.width <= 0 || this.rect.height <= 0) return;

    this.camera.resize(this.rect);

    this.renderer.setSize(this.rect.width, this.rect.height);
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, this.options.maxPixelRatio ?? 2),
    );

    const planes = this.domPlanes;
    for (let i = 0, n = planes.length; i < n; i++) {
      const plane = planes[i];
      plane.setCanvasRect(this.rect);
      plane.resize();
    }

    const objects = this.dom3DObjects;
    for (let i = 0, n = objects.length; i < n; i++) {
      const obj = objects[i];
      obj.setCanvasRect(this.rect);
      obj.resize();
    }

    this.effectManager.resize(this.rect.width, this.rect.height);

    const resizeCallbacks = this.resizeCallbacks;
    for (let i = 0, n = resizeCallbacks.length; i < n; i++) {
      resizeCallbacks[i]();
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.eventAbort.abort();
    this.pointer.destroy();

    this.domPlanes.forEach((plane) => plane.destroy());
    this.dom3DObjects.forEach((obj) => obj.destroy());
    this.domPlanes = [];
    this.dom3DObjects = [];
    this.domPlaneMeshes = [];
    this.domPlaneByMesh.clear();
    this.updateCallbacks = [];
    this.resizeCallbacks = [];

    this.scrollSync?.destroy();
    this.scrollSync = null;

    this.rafScroll?.destroy();
    this.rafScroll = null;

    this.effectManager.dispose();
    this.controls?.dispose();
    this.controls = null;
    this.renderer.dispose();
    this.canvas.remove();

    this.devTools.dispose();
  }

  private animate = () => {
    if (this.destroyed) return;
    this.rafId = requestAnimationFrame(this.animate);
    this.devTools.beginStats();

    if (this.controls) {
      this.controls.update();
    }

    const planes = this.domPlanes;
    const objects = this.dom3DObjects;

    this.rafScroll?.advance();
    this.refreshScrollCache();
    const scrollX = this._scroll.x;
    const scrollY = this._scroll.y;

    this.pointer.update();
    const mouse = this.pointer.getMouse();

    const callbacks = this.updateCallbacks;
    for (let i = 0, n = callbacks.length; i < n; i++) {
      callbacks[i]();
    }

    const elapsed = this.clock.getElapsedTime();
    this.effectManager.update(elapsed, mouse);

    this.scrollSync?.update(scrollX, scrollY);
    for (let i = 0, n = planes.length; i < n; i++) {
      planes[i]._tickRead(scrollX, scrollY);
    }
    for (let i = 0, n = objects.length; i < n; i++) {
      objects[i]._tickRead(scrollX, scrollY);
    }
    for (let i = 0, n = planes.length; i < n; i++) {
      planes[i].updateEffects(elapsed, mouse, scrollX, scrollY);
    }
    for (let i = 0, n = planes.length; i < n; i++) {
      planes[i]._tickApply(elapsed, scrollX, scrollY);
    }
    for (let i = 0, n = objects.length; i < n; i++) {
      objects[i]._tickApply(scrollX, scrollY);
    }

    for (let i = 0, n = planes.length; i < n; i++) {
      planes[i]._tickFeedback(elapsed);
    }
    for (let i = 0, n = planes.length; i < n; i++) {
      planes[i]._tickRenderComposer();
    }

    if (this.destroyed) {
      this.devTools.endStats();
      return;
    }

    this.effectManager.render(this.scene, this.camera.instance);

    this.pointer.endFrame();

    this.devTools.endStats();
  };
}
