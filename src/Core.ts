import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
// `lil-gui` は optional peer。GUI 連携の戻り値型としてのみ参照するので type-only import に
// 留める（runtime の dynamic import は DevTools 側、本体 bundle には含まれない）。
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
import type { BaseEffect, EffectOutput } from './effects/BaseEffect';
import { PointerController } from './PointerController';
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
  /**
   * `rafScroll` オプションで構築した管理下の RafScroll（autoStart: false）。
   * animate() の rAF ループ内で advance() を駆動する。未指定なら null。
   */
  private rafScroll: RafScroll | null = null;
  private options: DomSyncGLOptions;
  private rafId: number = 0;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private eventAbort: AbortController = new AbortController();
  /** マウス入力 / hover(raycast) を担うコントローラ（PointerController に分離）。 */
  private pointer!: PointerController;
  /** フルスクリーン post effect 群を集約管理する（EffectManager に分離）。 */
  private effectManager!: EffectManager;
  /** GUI / stats の lazy dynamic import を担う（DevTools に分離）。 */
  private devTools!: DevTools;
  /**
   * DOM 位置計算に使う確定スクロール値のキャッシュ。
   * 更新源は rAF tick（animate）で Core が 1 frame に 1 回確定する値。
   * ScrollSync 有効時は `effectiveScrollY` を反映する（毎フレーム経路と同一源）。
   * 単発イベント経路（plane/object の ctor・resize・setupModel）はこの live 参照を読み、
   * `window.scrollX/Y` の直読みをしない（スクロール源を Core に一本化するため）。
   * getMouse() と同方式で live な同一オブジェクトを共有しゼロアロケートにする。
   */
  private readonly _scroll: { x: number; y: number } = { x: 0, y: 0 };
  /**
   * raycast 対象の plane mesh 群。element 付き plane だけが入る（背景 plane は除外）。
   * createPlane/removePlane で出し入れし、PointerController に live 参照として共有する。
   */
  private domPlaneMeshes: THREE.Mesh[] = [];
  /**
   * raycast hit した mesh から DomPlane を O(1) で逆引きするための Map。
   * `domPlaneMeshes` と 1:1 で出し入れし（element 付き plane だけ）、PointerController に
   * live 参照として共有する。配列 find による線形逆引きを避けるためのもの。
   */
  private domPlaneByMesh: Map<THREE.Mesh, DomPlane> = new Map();
  /**
   * destroy 済みフラグ。animate() 実行中に user callback から destroy() が
   * 呼ばれると、renderer.dispose() 後の続きで renderer.render() を呼んで
   * WebGL エラーになる。各段階の冒頭で見て早期 return する。
   */
  private destroyed: boolean = false;

  constructor(selector: string | HTMLElement, options: DomSyncGLOptions = {}) {
    // コンテナを取得
    const element =
      typeof selector === 'string'
        ? document.querySelector(selector)
        : selector;
    if (!element) {
      throw new Error(`Container not found: ${selector}`);
    }
    this.container = element as HTMLElement;

    // canvasを生成してコンテナに追加
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
    this.options = { enableMouseTracking: true, showGUI: false, ...options };

    // 関心ごとに分離したコラボレータを構築する。DomSyncGL 本体はライフサイクルと rAF
    // オーケストレーションに専念し、入力/hover・effect・devtools は各クラスへ委譲する。
    // 既定は false（opt-in）。明示的に true のときだけ GUI を有効化する。
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

    // ScrollSync の初期化（renderer/camera生成後、init前に実行）
    if (options.scrollSync) {
      const syncOptions: ScrollSyncOptions =
        typeof options.scrollSync === 'object' ? options.scrollSync : {};
      this.scrollSync = new ScrollSync(this.container, syncOptions);
      // ScrollSync有効時はlogicalRectを使用
      this.rect = this.scrollSync.logicalRect;
      // fixed/absolute container 化で canvas サイズは window resize 以外で変わらず、
      // window resize は Core 側で直接 handle する。よって ScrollSync の resize を
      // Core へ通知する経路は不要（旧 architecture の callback 配線は廃止済み）。
    }

    // RafScroll（rAF 同期 virtual scroll）を Core 管理下で構築する。
    // autoStart: false で自前ループは持たせず、animate() の単一 rAF 内で advance() を
    // refreshScrollCache() より前に駆動する。これで「RafScroll を別 new して別 rAF ループに
    // した場合に生成順しだいで scroll が 1 フレームずれる」問題を構造的に排除する。
    if (options.rafScroll) {
      const rafScrollOptions: RafScrollOptions =
        typeof options.rafScroll === 'object' ? options.rafScroll : {};
      this.rafScroll = new RafScroll({ ...rafScrollOptions, autoStart: false });
    }

    // スクロールキャッシュを種付け（ScrollSync 初期化後）。以降は animate の rAF tick で更新。
    this.refreshScrollCache();

    // renderer/cameraを正しいrectでセットアップ
    this.init();

    // stats.js の FPS パネル（optional peer）を lazy load する（DevTools が dynamic import）。
    // animate() 内の begin/end は load 完了前は no-op で安全。
    this.devTools.loadStats();

    this.setupEventListeners();
    this.animate();
  }

  private init() {
    // シーンの背景を透明に
    this.scene.background = null;

    // レンダラーの設定（this.rectは ScrollSync有効時はlogicalRect）
    this.renderer.setSize(this.rect.width, this.rect.height);
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, this.options.maxPixelRatio ?? 2),
    );

    // カメラをrectに合わせて再セットアップ
    this.camera.resize(this.rect);

    // 出力カラースペース（デフォルト SRGB。Linear が必要な場合は options で指定）
    this.renderer.outputColorSpace =
      this.options.outputColorSpace ?? THREE.SRGBColorSpace;
  }

  // sceneのgetterを追加
  getScene() {
    return this.scene;
  }

  // カメラのgetterを追加
  getCamera() {
    return this.camera;
  }

  // rendererのgetterを追加
  getRenderer() {
    return this.renderer;
  }

  // lightのgetterを追加
  getLight() {
    return this.light;
  }

  // canvasサイズを追加
  getViewPort() {
    return this.rect;
  }

  // マウス座標を取得（UV座標: 0~1）
  getMouse() {
    return this.pointer.getMouse();
  }

  // 確定スクロール値のキャッシュを取得。live な同一オブジェクトを返す（getMouse と同方式）。
  // 保持する場合は呼び出し側で clone すること。
  getScroll(): Readonly<{ x: number; y: number }> {
    return this._scroll;
  }

  // rafScroll オプションで構築した管理下の RafScroll を取得（未指定なら null）。
  getRafScroll(): RafScroll | null {
    return this.rafScroll;
  }

  // 確定スクロール値を _scroll キャッシュへ書き込む唯一の経路。
  // constructor の種付けと animate の rAF tick の両方から呼び、毎フレーム経路と
  // 単発経路のスクロール源を完全に同一に保つ（片方だけ変えるとこの不変条件が静かに破れる）。
  //
  // scrollY に `ScrollSync.computeEffectiveScrollY()` を使う理由:
  // 通常スクロール時は `window.scrollY` と同値だが、iOS Safari の上端 rubber-band /
  // pull-to-refresh 中は visual viewport 分マイナスに振れる。この差を container の
  // transform と plane 位置計算に同値で配ることで、rubber-band 中も canvas と DOM が
  // 同じ視覚オフセットで揃う。ScrollSync を使っていない場合は補正不要なので window.scrollY。
  private refreshScrollCache(): void {
    this._scroll.x = window.scrollX;
    this._scroll.y = this.scrollSync
      ? ScrollSync.computeEffectiveScrollY()
      : window.scrollY;
  }

  // 前回のマウス座標を取得（UV座標: 0~1）
  getPrevMouse() {
    return this.pointer.getPrevMouse();
  }

  // マウス移動量を取得。内部スクラッチを使い回すので、保持したい場合は呼び出し側で clone する。
  getMouseDelta() {
    return this.pointer.getMouseDelta();
  }

  // ScrollSyncを取得
  getScrollSync() {
    return this.scrollSync;
  }

  // オブジェクトを追加するメソッド
  addObject(object: THREE.Object3D) {
    this.scene.add(object);
  }

  // オブジェクトを削除するメソッド
  removeObject(object: THREE.Object3D) {
    this.scene.remove(object);
  }

  // DomPlaneを作成するメソッド
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
    // plane.addEffect() からも GUI を生やせるよう DomSyncGL の lazy-getter を渡す。
    // showGUI が有効（明示 true）でなければ provider は渡さない（DomPlane 側で何もしない）。
    // lil-gui は optional peer の dynamic import なので Promise を返す provider。
    if (this.options.showGUI === true) {
      domPlane._setGuiProvider(() => this._ensureGUIAsync());
    }
    this.domPlanes.push(domPlane);
    // element 無し (= フルスクリーン背景 plane) は raycast 候補から外す。
    // canvas 全面に重なるので element 付き plane と必ず distance 同値で衝突し、
    // stable sort で先勝ち → 後から push された DOM 連動 plane の hover を奪う。
    // 背景 plane は概念的に hover の対象ではないので最初から除外する。
    if (element) {
      const mesh = domPlane.getMesh();
      this.domPlaneMeshes.push(mesh);
      this.domPlaneByMesh.set(mesh, domPlane);
    }

    return domPlane;
  }

  // DomPlaneを削除するメソッド
  removePlane(domPlane: DomPlane) {
    if (this.destroyed) return;
    const index = this.domPlanes.indexOf(domPlane);
    if (index > -1) {
      this.domPlanes.splice(index, 1);
      // createPlane で element 無し plane は push していないので indexOf で引く。
      const mesh = domPlane.getMesh();
      const meshIndex = this.domPlaneMeshes.indexOf(mesh);
      if (meshIndex > -1) this.domPlaneMeshes.splice(meshIndex, 1);
      this.domPlaneByMesh.delete(mesh);
      domPlane.destroy();
    }
  }

  // Dom3DObject を作成する。
  // - selector あり (string / HTMLElement): DOM 要素位置に追従。
  // - selector が null/undefined: scene 原点に固定 (viewport 中心固定の使い方)。
  //   ScrollSync 有効時でも、Lenis のような virtual scroll で JS rAF と paint の
  //   scrollY が同一に揃っていれば container は viewport に完璧固定され、scene 原点
  //   固定 obj も視覚的に viewport 固定として機能する。
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

  // Dom3DObjectを削除するメソッド
  remove3DObject(dom3DObject: Dom3DObject) {
    if (this.destroyed) return;
    const index = this.dom3DObjects.indexOf(dom3DObject);
    if (index > -1) {
      this.dom3DObjects.splice(index, 1);
      dom3DObject.destroy();
    }
  }

  // アニメーションループに更新処理を追加するメソッド（戻り値で削除可能）
  addUpdateCallback(callback: () => void): () => void {
    if (this.destroyed) return () => {};
    this.updateCallbacks.push(callback);
    return () => {
      const index = this.updateCallbacks.indexOf(callback);
      if (index > -1) this.updateCallbacks.splice(index, 1);
    };
  }

  // リサイズ時の処理を追加するメソッド（戻り値で削除可能）
  addResizeCallback(callback: () => void): () => void {
    if (this.destroyed) return () => {};
    this.resizeCallbacks.push(callback);
    return () => {
      const index = this.resizeCallbacks.indexOf(callback);
      if (index > -1) this.resizeCallbacks.splice(index, 1);
    };
  }

  // OrbitControlsを有効化するメソッド
  enableOrbitControls() {
    if (this.destroyed) {
      throw new Error('[DomSyncGL] enableOrbitControls(): destroy 済みのインスタンスでは使えません。');
    }
    if (!this.controls) {
      // ScrollSync で container に pointer-events:none を当てていると
      // 子の canvas も入力を受け取れなくなるので、canvas 側だけ復活させる。
      if (this.scrollSync) {
        this.canvas.style.pointerEvents = 'auto';
      }
      this.controls = new OrbitControls(this.camera.instance, this.canvas);
    }
    return this.controls;
  }

  // OrbitControlsを取得するメソッド
  getControls() {
    return this.controls;
  }

  /**
   * canvas 全体にエフェクトを追加する。内部で EffectComposer を自動生成する（EffectManager 委譲）。
   *
   * **注意**: `setPostEffect()` でカスタム postEffect を入れている状態でこれを呼ぶと、
   * 自動生成された EffectComposer で上書きされる（カスタム postEffect の dispose は
   * 呼ばれない＝呼び出し側の責務）。両 API の併用は避けること。
   */
  addEffect<T extends BaseEffect>(
    effect: T,
    options?: { output?: EffectOutput },
  ): T {
    if (this.destroyed) {
      throw new Error('[DomSyncGL] addEffect(): destroy 済みのインスタンスでは使えません。');
    }
    return this.effectManager.addEffect(
      effect,
      this.rect.width,
      this.rect.height,
      options,
    );
  }

  /**
   * lil-gui を dynamic import で読み込み、root インスタンスを lazy 生成して返す。
   * @internal DomPlane.addEffect の GUI provider から呼ばれる。
   */
  _ensureGUIAsync(): Promise<GUI> {
    return this.devTools.ensureGUI();
  }

  /**
   * root の lil-gui インスタンスを取得 (sync)。
   * lil-gui は dynamic import なので load 中は `null`。確実に得たい場合は `getGUIAsync()`。
   * `showGUI: false` の場合は常に `null`。
   */
  getGUI(): GUI | null {
    return this.devTools.getGUI();
  }

  /**
   * lil-gui を必要に応じて load し、インスタンスを返す。`showGUI: false` の場合は `null`。
   */
  getGUIAsync(): Promise<GUI | null> {
    return this.devTools.getGUIAsync();
  }

  /**
   * ポストエフェクトを設定（低レベル API）。通常は `addEffect()` を使うこと。
   *
   * **注意**: `addEffect()` で追加済みのエフェクトがある状態で呼ぶと、自動 EffectComposer を
   * 捨てて引数の postEffect に差し替える（既存 effect は dispose される）。
   */
  setPostEffect(postEffect: EffectLike): void {
    if (this.destroyed) {
      throw new Error('[DomSyncGL] setPostEffect(): destroy 済みのインスタンスでは使えません。');
    }
    this.effectManager.setPostEffect(postEffect);
  }

  /**
   * `addEffect()` で登録した effect を 1 つ取り除く。登録されていなければ `false`。
   */
  removeEffect(effect: BaseEffect): boolean {
    if (this.destroyed) return false;
    return this.effectManager.removeEffect(effect);
  }

  /**
   * 登録されたエフェクトとポストエフェクトをすべて解除して破棄する。
   */
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

    // ScrollSync 無効時はユーザー任せの canvas styling なので scroll で動く前提で
    // invalidate する。有効時は `position: fixed` で viewport に固定されており動かない
    // ので invalidate 不要 (mousemove ごとの bcr 読みも消える)。
    if (!this.scrollSync) {
      window.addEventListener('scroll', this.pointer.invalidateRect, {
        signal,
        passive: true,
      });
    }

    // マウスイベントは setMouseTrackingEnabled 経由で attach する（動的切替対応）。
    if (this.options.enableMouseTracking) {
      this.setMouseTrackingEnabled(true);
    }
  }

  /**
   * mousemove tracking の動的な ON/OFF（PointerController へ委譲）。
   * - true: 未 attach なら mousemove listener を追加する
   * - false: attach 済みなら detach する（hover も解除）
   *
   * `destroy()` 時は PointerController.destroy() で自動 detach される。
   */
  setMouseTrackingEnabled(enabled: boolean): void {
    if (this.destroyed) return;
    this.options.enableMouseTracking = enabled;
    this.pointer.setEnabled(enabled);
  }

  private onResize() {
    // canvas viewport rect は確実に変わるのでキャッシュを invalidate
    this.pointer.invalidateRect();

    // plane.resize()/obj.resize() は各コンポーネントが保持する live 参照(= Core の this._scroll)と
    // その場の getBoundingClientRect() を合成して pageTop を確定する。rect 読み取りと同一時刻の
    // スクロール値を共有させるため、resize 経路の冒頭でキャッシュを 1 回だけ更新する。
    // (scrollSync 有効時は documentElement.BCR を強制するためループ外で 1 回)。
    this.refreshScrollCache();

    if (this.scrollSync) {
      // ScrollSync 有効時: container の元 CSS ratio (init 時 snapshot) を基準に
      // window 寸法から再計算させる。引数省略で ratio 経路が走る。
      this.scrollSync.updateSize();
      this.rect = this.scrollSync.logicalRect;
    } else {
      this.rect = this.container.getBoundingClientRect();
    }

    // container が一時的に display:none 等になっているとき、以降の計算で NaN が混ざるので skip。
    if (this.rect.width <= 0 || this.rect.height <= 0) return;

    // カメラのアスペクト比を更新
    this.camera.resize(this.rect);

    // レンダラーのサイズを更新
    this.renderer.setSize(this.rect.width, this.rect.height);
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, this.options.maxPixelRatio ?? 2),
    );

    // すべてのDomPlaneのcanvasRectとサイズと位置を更新
    const planes = this.domPlanes;
    for (let i = 0, n = planes.length; i < n; i++) {
      const plane = planes[i];
      plane.setCanvasRect(this.rect);
      plane.resize();
    }

    // すべてのDom3DObjectのcanvasRectとサイズと位置を更新
    const objects = this.dom3DObjects;
    for (let i = 0, n = objects.length; i < n; i++) {
      const obj = objects[i];
      obj.setCanvasRect(this.rect);
      obj.resize();
    }

    // ポストエフェクト / 各 effect のリサイズ
    this.effectManager.resize(this.rect.width, this.rect.height);

    // 登録された更新処理を実行
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

    // OrbitControlsの更新
    if (this.controls) {
      this.controls.update();
    }

    const planes = this.domPlanes;
    const objects = this.dom3DObjects;

    // === scroll snapshot（rAF tick 上で 1 回だけ確定）===
    // 1 frame で読んだ scrollX/Y を以下すべてに同値で配る:
    //   (a) ScrollSync の container transform
    //   (b) plane / object の scene 位置計算（_tickApply）
    //   (c) effect update 内の local-UV 算出（plane.updateEffects → window 読みを禁ずる）
    // Phase A 内で effect.update / plane.updateEffects が global mouse から
    // plane-local UV を再構成する際にも、ここで取った scrollX/Y を使う。
    // scrollY に effectiveScrollY を使う理由は refreshScrollCache を参照。
    //
    // ⚠️ 順序が重要: RafScroll(管理モード) の advance() を refreshScrollCache() の **前** に
    // 走らせる。advance() が window.scrollTo を確定 → 直後の refreshScrollCache() が同一
    // フレームの最新 scrollY を読む。単一 rAF ループ内なので登録順依存は発生しない。
    this.rafScroll?.advance();
    this.refreshScrollCache();
    const scrollX = this._scroll.x;
    const scrollY = this._scroll.y;

    // === Phase A: ユーザー callback + マウス hover 確定 + エフェクト update ===
    // raycaster + setHoverInfo を rAF tick 内で呼ぶことで uMouseUV / uIsHovered の
    // 更新タイミングが paint と揃う (mousemove 非同期発火に引きずられない)。
    this.pointer.update();
    const mouse = this.pointer.getMouse();

    // DOM には触れないユーザー処理を先に消化する。
    // 登録された更新処理（ホットパスのため for ループで回す）
    const callbacks = this.updateCallbacks;
    for (let i = 0, n = callbacks.length; i < n; i++) {
      callbacks[i]();
    }

    const elapsed = this.clock.getElapsedTime();
    this.effectManager.update(elapsed, mouse);

    // === Phase B: ScrollSync + DOM read → per-plane effect → uniform/transform write ===
    // 3 ステップで進む:
    //   (1) _tickRead: `getBoundingClientRect()` 等の **DOM read のみ**
    //   (2) updateEffects: **uniform 書き込み** (uMouseUV, effect.update 経由)
    //   (3) _tickApply: **mesh.position / scale の書き込み** (THREE.js 側のみ、DOM には触れない)
    //
    // (1)→(2)→(3) の順を守る理由:
    //   - (2) は `positionCalculator.rect` を参照するので、(1) で更新済みでないと
    //     「1 フレ古い rect」を使ってしまう（updateRectEveryFrame: true の plane のみ実害）。
    //   - (3) は DOM read を発生させないので、(1) と一塊にせず後ろに置いてよい。
    //   - DOM read → write の境界は (1) と (2) の間。両者を密接させることで bcr スナップショットの
    //     鮮度を最大化しつつ、複数 plane 間で強制リフローを起こさない。
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

    // === Phase C: feedback バッファ更新 → PlaneComposer の per-plane FBO レンダリング ===
    // feedback(generator) は plane の材料テクスチャを焼くので、PlaneComposer / main render より
    // 前に step する（最新の出力 uniform を持った状態で plane を描く）。
    for (let i = 0, n = planes.length; i < n; i++) {
      planes[i]._tickFeedback(elapsed);
    }
    for (let i = 0, n = planes.length; i < n; i++) {
      planes[i]._tickRenderComposer();
    }

    // === Phase D: 本体レンダリング ===
    // user callback 内で destroy() が呼ばれている可能性があるので、
    // GL context を触る render はフラグを見てから。renderer.dispose() 後に
    // render を呼ぶと WebGL エラーになる。
    if (this.destroyed) {
      this.devTools.endStats();
      return;
    }
    // ポストエフェクトあり: シーン→FBO→エフェクト適用→キャンバス。無ければ通常 render。
    this.effectManager.render(this.scene, this.camera.instance);

    // フレームの最後にマウス座標を同期
    this.pointer.endFrame();

    this.devTools.endStats();
  };
}
