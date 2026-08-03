import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type GUI from 'lil-gui';
import { Camera } from './Camera';
import { Light } from './Light';
import { DomPlane } from './DomPlane';
import { DomTextPlane } from './DomTextPlane';
import { Dom3DObject } from './Dom3DObject';
import { ScrollSync } from './ScrollSync';
import type { EffectLike } from './EffectComposer';
import type { ScrollSyncOptions } from './ScrollSync';
import type { BaseEffect } from './effects/BaseEffect';
import { PointerController, type PointerType } from './PointerController';
import { EffectManager } from './EffectManager';
import { DevTools } from './DevTools';
import type {
  CreatePlaneOptions,
  CreateTextPlaneOptions,
  Create3DObjectOptions,
  DomSyncGLOptions,
} from './types';

export class DomSyncGL {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  renderer: THREE.WebGPURenderer;
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
  private options: DomSyncGLOptions;
  private rafId: number = 0;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private offscreenObserver: IntersectionObserver | null = null;
  private _paused: boolean = false;
  // animate() は自己再帰で rAF を張り直すため、二重に start するとループが 2 本走る。
  // start 済みかをここで持ち、再入を startLoop() で一括して弾く。
  private _rafRunning: boolean = false;
  private eventAbort: AbortController = new AbortController();
  private pointer!: PointerController;
  private effectManager!: EffectManager;
  private devTools!: DevTools;
  private readonly _scroll: { x: number; y: number } = { x: 0, y: 0 };
  private domPlaneMeshes: THREE.Mesh[] = [];
  private domPlaneByMesh: Map<THREE.Mesh, DomPlane> = new Map();
  private destroyed: boolean = false;
  // update() が取得したフレーム状態を render() へ渡すための保持。update() 未実行で
  // render() を呼んでも直近フレーム（初期値 0）で描画でき例外にならない。
  private _frameElapsed: number = 0;
  /**
   * renderer の非同期初期化の完了を示す Promise。WebGPU の device 取得は
   * async のため、バックエンド確定後の処理（isWebGPUBackend() の判定など）は
   * これを await してから行う。await しなくても render() は初期化完了まで
   * no-op になるだけで安全。
   */
  readonly ready: Promise<void>;
  private _rendererReady = false;

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
    this.renderer = new THREE.WebGPURenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      forceWebGL: options.forceWebGL ?? false,
    });
    // 初期化失敗（WebGPU も WebGL 2 も使えない環境）は console へ流しつつ、
    // ready を await する呼び出し元でも捕捉できるようにする。内部で catch した
    // 別 Promise を作らず同一 Promise に catch を付けるのは、呼び出し元が
    // await しなかった場合の unhandled rejection を防ぐため。
    this.ready = this.renderer.init().then(() => {
      this._rendererReady = true;
    });
    this.ready.catch((err) => {
      console.error('[DomSyncGL] renderer の初期化に失敗しました。', err);
    });
    this.camera = new Camera(this.rect);
    this.light = new Light(this.scene);
    this.controls = null;
    this.updateCallbacks = [];
    this.resizeCallbacks = [];
    this.domPlanes = [];
    this.dom3DObjects = [];
    this.clock = new THREE.Clock();
    this.options = { ...options };

    this.options.enablePointerTracking =
      options.enablePointerTracking ?? options.enableMouseTracking ?? true;

    const gui = options.gui ?? null;
    this.devTools = new DevTools({
      stats: options.stats ?? null,
      gui,
    });
    this.effectManager = new EffectManager({
      renderer: this.renderer,
      gui,
      effectSamples: this.options.effectSamples ?? 4,
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

    this.refreshScrollCache();

    this.init();

    this.setupEventListeners();
    this.startLoop();
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

  /**
   * オフスクリーン停止中か。pauseWhenOffscreen が無効なら常に false。
   * `autoRaf: false` のアプリ側ループから、自前の毎フレーム処理をまとめて
   * 飛ばしたい時に読む。
   */
  isPaused(): boolean {
    return this._paused;
  }

  getPointerType(): PointerType {
    return this.pointer.getPointerType();
  }

  getScrollSync() {
    return this.scrollSync;
  }

  /**
   * WebGPU バックエンドで動作しているか。WebGL 2 フォールバック時は false。
   * バックエンドは `ready` の解決後に確定するため、init 前の呼び出しは常に false。
   */
  isWebGPUBackend(): boolean {
    if (!this._rendererReady) return false;
    const backend = (
      this.renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }
    ).backend;
    return backend?.isWebGPUBackend === true;
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

    domPlane._setGui(this.devTools.getGUI());
    this.domPlanes.push(domPlane);

    if (element) {
      const mesh = domPlane.getMesh();
      this.domPlaneMeshes.push(mesh);
      this.domPlaneByMesh.set(mesh, domPlane);
    }

    domPlane._setOnDestroy(() => this.unregisterPlane(domPlane));

    return domPlane;
  }

  createTextPlane(
    selector: string | HTMLElement,
    options?: CreateTextPlaneOptions,
  ): DomTextPlane {
    if (this.destroyed) {
      throw new Error('[DomSyncGL] createTextPlane(): destroy 済みのインスタンスでは使えません。');
    }
    const element =
      typeof selector === 'string'
        ? (document.querySelector(selector) as HTMLElement | null)
        : selector;
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    const plane = new DomTextPlane(
      element,
      this.scene,
      this.rect,
      this._scroll,
      this.renderer,
      options,
      this.clock,
    );
    plane._setGui(this.devTools.getGUI());
    this.domPlanes.push(plane);
    const mesh = plane.getMesh();
    this.domPlaneMeshes.push(mesh);
    this.domPlaneByMesh.set(mesh, plane);
    plane._setOnDestroy(() => this.unregisterPlane(plane));
    return plane;
  }

  // 生成時に登録する解除 callback の実体。destroy() 経由で呼ばれ、二重管理を避ける。
  private unregisterPlane(domPlane: DomPlane): void {
    const index = this.domPlanes.indexOf(domPlane);
    if (index > -1) this.domPlanes.splice(index, 1);
    const mesh = domPlane.getMesh();
    const meshIndex = this.domPlaneMeshes.indexOf(mesh);
    if (meshIndex > -1) this.domPlaneMeshes.splice(meshIndex, 1);
    this.domPlaneByMesh.delete(mesh);
  }

  removePlane(domPlane: DomPlane) {
    if (this.destroyed) return;
    // 管理外(別インスタンス生成・破棄済み)の plane は従来どおり no-op にする。
    if (!this.domPlanes.includes(domPlane)) return;
    // registry からの解除は destroy() が呼ぶ unregister callback に一本化する。
    domPlane.destroy();
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
    dom3DObject._setOnDestroy(() => this.unregister3DObject(dom3DObject));

    return dom3DObject;
  }

  private unregister3DObject(dom3DObject: Dom3DObject): void {
    const index = this.dom3DObjects.indexOf(dom3DObject);
    if (index > -1) this.dom3DObjects.splice(index, 1);
  }

  remove3DObject(dom3DObject: Dom3DObject) {
    if (this.destroyed) return;
    if (!this.dom3DObjects.includes(dom3DObject)) return;
    dom3DObject.destroy();
  }

  /**
   * 毎フレームの更新処理に呼ばれる callback を登録し、解除関数を返す。
   * dispatch は snapshot に対して行うため、dispatch 中に追加した callback は
   * 次フレームから呼ばれ、dispatch 中に解除した callback はその回はまだ呼ばれうる。
   */
  addUpdateCallback(callback: () => void): () => void {
    if (this.destroyed) return () => {};
    this.updateCallbacks.push(callback);
    return () => {
      const index = this.updateCallbacks.indexOf(callback);
      if (index > -1) this.updateCallbacks.splice(index, 1);
    };
  }

  /**
   * resize 時に呼ばれる callback を登録し、解除関数を返す。
   * dispatch セマンティクスは addUpdateCallback と同じ。
   */
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

  getGUI(): GUI | null {
    return this.devTools.getGUI();
  }

  setPostEffect(postEffect: EffectLike, options?: { owned?: boolean }): void {
    if (this.destroyed) {
      throw new Error('[DomSyncGL] setPostEffect(): destroy 済みのインスタンスでは使えません。');
    }
    this.effectManager.setPostEffect(
      postEffect,
      this.rect.width,
      this.rect.height,
      options,
    );
  }

  removeEffect(effect: BaseEffect): boolean {
    if (this.destroyed) return false;
    return this.effectManager.removeEffect(effect);
  }

  clearEffects(): void {
    if (this.destroyed) return;
    this.effectManager.clearEffects();
  }

  // window.resize と ResizeObserver を同じ 100ms debounce 経路へ合流させる。
  // debounce が同一フレームの複数通知も coalesce する。
  private scheduleResize = () => {
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => this.onResize(), 100);
  };

  private setupEventListeners() {
    const signal = this.eventAbort.signal;

    window.addEventListener('resize', this.scheduleResize, { signal });

    // window サイズが変わらない container 固有のサイズ変化（Grid 列幅・サイドバー
    // 開閉・親のアニメーション等）にも追従する。未対応環境では window.resize のみ。
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.scheduleResize);
      this.resizeObserver.observe(this.container);
    }

    // dom モードは canvas がスクロールで動きうるので、scrollSync 無しの場合と同様に
    // スクロールで pointer のキャッシュした rect を無効化する必要がある。
    if (!this.scrollSync || this.scrollSync.attach === 'dom') {
      window.addEventListener('scroll', this.pointer.invalidateRect, {
        signal,
        passive: true,
      });
    }
    this.setupOffscreenPause();
    if (this.options.enablePointerTracking) {
      this.setPointerTrackingEnabled(true);
    }
  }

  /**
   * attach: 'dom' の container がオフスクリーンの間だけ描画ループを止める監視。
   * translate モードは container を毎 tick viewport へ貼り直す構造上オフスクリーンに
   * ならないため対象外。IntersectionObserver 未対応環境では監視を張らず、
   * 従来どおり回り続ける（ResizeObserver と同じ degrade 方針）。
   */
  private setupOffscreenPause(): void {
    if (this.options.pauseWhenOffscreen !== true) return;

    if (this.scrollSync?.attach !== 'dom') {
      if (import.meta.env?.DEV) {
        console.warn(
          '[DomSyncGL] pauseWhenOffscreen は scrollSync: { attach: "dom" } の時のみ有効です。',
        );
      }
      return;
    }
    if (typeof IntersectionObserver === 'undefined') return;

    this.offscreenObserver = new IntersectionObserver(
      (entries) => {
        if (this.destroyed) return;
        // 1 回の callback に同一 target の観測が複数積まれうるため、DomPlane の
        // entries[0] ではなく最新の 1 件で判定する。取りこぼすと停止状態が反転したまま固まる。
        this.setPaused(!entries[entries.length - 1].isIntersecting);
      },
      { rootMargin: this.options.pauseRootMargin ?? '100%' },
    );
    this.offscreenObserver.observe(this.container);
  }

  private setPaused(paused: boolean): void {
    if (this.destroyed || this._paused === paused) return;
    this._paused = paused;

    if (paused) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
      this._rafRunning = false;
      return;
    }
    this.resyncFrameState();
    this.startLoop();
  }

  /**
   * 停止区間を挟んだせいで壊れる「前フレームとの差分」を、まとめて現在へ寄せ直す。
   * これを飛ばすと再開初回だけ elapsed が停止時間ぶん飛び、strength が 1 に張り付き、
   * pointer の delta が停止中の移動量まるごととして計上される。
   */
  private resyncFrameState(): void {
    // THREE.Clock は getDelta() を呼ばない限り進まないので elapsedTime は停止前のまま。
    // oldTime だけ現在時刻へ寄せれば、再開初回の delta が ~0 になり時間が連続する。
    // stop()/start() を使わないのは start() が elapsedTime を 0 に戻すため。
    this.clock.oldTime = performance.now();
    this.scrollSync?.resetStrengthBaseline();
    // 停止中に container はスクロールで動いているので canvas rect のキャッシュを捨てる。
    this.pointer.invalidateRect();
    // prevMouse を現在値へ寄せ、再開初回の getMouseDelta() を 0 から始める。
    this.pointer.endFrame();
    this.refreshScrollCache();
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

  /**
   * debounce を挟まずレイアウトを即座に再計算する。
   * SPA 遷移直後など、アプリ側が任意タイミングで反映したいときに呼ぶ。
   * destroy 済みなら no-op。
   */
  resize(): void {
    if (this.destroyed) return;
    this.onResize();
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

    // dispatch 中の解除で固定長ループが壊れないよう snapshot を回す
    const resizeCallbacks = this.resizeCallbacks.slice();
    for (let i = 0, n = resizeCallbacks.length; i < n; i++) {
      resizeCallbacks[i]();
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this._rafRunning = false;
    this.offscreenObserver?.disconnect();
    this.offscreenObserver = null;
    this.eventAbort.abort();
    this.pointer.destroy();

    // 各 destroy() が unregister callback 経由で registry を splice するため、
    // snapshot を回して反復中の要素スキップを防ぐ。
    this.domPlanes.slice().forEach((plane) => plane.destroy());
    this.dom3DObjects.slice().forEach((obj) => obj.destroy());
    this.domPlanes = [];
    this.dom3DObjects = [];
    this.domPlaneMeshes = [];
    this.domPlaneByMesh.clear();
    this.updateCallbacks = [];
    this.resizeCallbacks = [];

    this.scrollSync?.destroy();
    this.scrollSync = null;

    this.effectManager.dispose();
    this.controls?.dispose();
    this.controls = null;
    this.renderer.dispose();
    this.canvas.remove();
  }

  // animate() の唯一の起点。二重起動・停止中・destroy 済み・autoRaf: false を
  // ここで一括して弾く（animate() は自己再帰なので、素で 2 回呼ぶと rAF が 2 本走る）。
  private startLoop(): void {
    if (this.destroyed || this._paused) return;
    if (this.options.autoRaf === false) return;
    if (this._rafRunning) return;
    this._rafRunning = true;
    this.animate();
  }

  private animate = () => {
    if (this.destroyed || this._paused) {
      this._rafRunning = false;
      return;
    }
    this.rafId = requestAnimationFrame(this.animate);
    this.tick();
  };

  /**
   * 状態更新フェーズ。DOM 読み取り・スクロール/ポインタ更新・plane/object の
   * 座標反映を行う。GPU 描画パスは一切実行しない。
   * 更新と描画を別タイミングで回したい場合に render() と個別に呼べる。
   * destroy 済みなら no-op。
   *
   * @param _time rAF のタイムスタンプ（Lenis との API 対称性のために受け取るが内部では未使用）
   */
  update = (_time?: number) => {
    if (this.destroyed) return;

    if (this.controls) {
      this.controls.update();
    }

    const planes = this.domPlanes;
    const objects = this.dom3DObjects;

    this.refreshScrollCache();
    const scrollX = this._scroll.x;
    const scrollY = this._scroll.y;

    this.pointer.update();
    const mouse = this.pointer.getMouse();

    // dispatch 中の解除で固定長ループが壊れないよう snapshot を回す
    const callbacks = this.updateCallbacks.slice();
    for (let i = 0, n = callbacks.length; i < n; i++) {
      callbacks[i]();
    }

    const elapsed = this.clock.getElapsedTime();
    this._frameElapsed = elapsed;
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
  };

  /**
   * 描画フェーズ。plane composer のフィードバック/合成と最終出力の描画を行う。
   * update() 未実行でも例外にならない（直近フレームの状態で描画する）。
   * destroy 済みなら no-op。
   *
   * 契約: 呼び出し前にバインドされていた RenderTarget を呼び出し後も維持する。
   * 最終出力は outputTarget（既定は画面 = null）にのみ書く。複数 Scene を外部 FBO へ
   * 描いて遷移させる用途では outputTarget を指定して外部の RenderTarget を保つ。
   *
   * @param options.outputTarget 最終描画先。省略時は画面（null）。
   */
  render = (options?: { outputTarget?: THREE.RenderTarget | null }) => {
    if (this.destroyed) return;
    // renderer.init() 完了前に GPU コマンドを発行できないため no-op にする。
    // update() は GPU を触らないのでガード不要（先行して状態だけ進む）。
    if (!this._rendererReady) return;

    const outputTarget = options?.outputTarget ?? null;
    const elapsed = this._frameElapsed;
    const planes = this.domPlanes;

    for (let i = 0, n = planes.length; i < n; i++) {
      planes[i]._tickFeedback(elapsed);
    }
    for (let i = 0, n = planes.length; i < n; i++) {
      planes[i]._tickRenderComposer();
    }

    this.effectManager.render(this.scene, this.camera.instance, outputTarget);

    this.pointer.endFrame();
  };

  /**
   * 1 フレーム分の更新・描画を実行する（内部は update() → render() の分割で、
   * 更新と描画を別タイミングで回したい場合は個別に呼べる）。
   * `autoRaf: false` で初期化した場合に、アプリ側の rAF ループから呼び出す。
   * Lenis と併用する場合は `lenis.raf(time)` の後に呼ぶことで、
   * スクロール確定後の値で WebGL を配置でき、同一フレーム内で同期する。
   *
   * @param _time rAF のタイムスタンプ（Lenis との API 対称性のために受け取るが内部では未使用）
   */
  tick = (_time?: number) => {
    if (this.destroyed) return;
    // オフスクリーン停止中は、autoRaf: false のアプリ側ループから呼ばれても描画しない。
    // beginStats() より手前で返し、stats の begin/end 不整合を作らない。
    if (this._paused) return;
    // 計測は tick 全体のみで開閉し、update()/render() 単独呼び出しでは
    // begin/end の不整合が起きないようにする。
    this.devTools.beginStats();
    this.update(_time);
    this.render();
    this.devTools.endStats();
  };
}
