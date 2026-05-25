import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
// `stats.js` / `lil-gui` は optional peer。runtime では `showStats` / `showGUI` が
// 有効な時だけ dynamic import するので、ここは type-only import で .d.ts のみに残す
// (tree-shaking で本体 bundle に含まれない)。
import type Stats from 'stats.js';
import type GUI from 'lil-gui';
import { Camera } from './Camera';
import { Light } from './Light';
import { DomPlane } from './DomPlane';
import { Dom3DObject } from './Dom3DObject';
import { ScrollSync } from './ScrollSync';
import { EffectComposer } from './EffectComposer';
import type { EffectLike } from './EffectComposer';
import type { ScrollSyncOptions } from './ScrollSync';
import type { BaseEffect } from './effects/BaseEffect';
import type {
  CreatePlaneOptions,
  Create3DObjectOptions,
  WebGLAppOptions,
} from './types';

export class WebGLApp {
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
  private options: WebGLAppOptions;
  private rafId: number = 0;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private eventAbort: AbortController = new AbortController();
  /**
   * mousemove listener 専用の AbortController。`setMouseTrackingEnabled()` で動的に
   * detach 可能にするため `eventAbort` とは別に持つ。null の時は attach 済みでない。
   */
  private _mouseAbort: AbortController | null = null;
  /**
   * canvas の viewport 上の矩形をキャッシュ。mousemove ごとに `getBoundingClientRect`
   * を呼ぶと layout 強制が走るため、resize 時 + (ScrollSync 無効時の) scroll 時に
   * invalidate する形にしてフィールドアクセスで済むようにする。
   * ScrollSync 有効時は container を `position: fixed` で viewport にロックしているので
   * scroll で動かず、invalidate 不要。
   */
  private _canvasRect: DOMRect | null = null;
  private mouse: THREE.Vector2;
  private prevMouse: THREE.Vector2;
  /**
   * マウスが canvas 矩形の内側に居るか。mousemove イベントごとに更新し、
   * rAF tick 内の raycaster はこのフラグで実行を決める。
   * (uMouseUV の更新を完全に rAF 駆動にすることで paint と同期させ、
   *  「mousemove 非同期発火による uniform のちらつき」を消す)
   */
  private _mouseInside: boolean = false;
  /** raycaster で使う NDC バッファ (毎フレ allocate を避ける) */
  private _ndcBuf: THREE.Vector2 = new THREE.Vector2();
  /** getMouseDelta の戻り値スクラッチ (毎フレ clone を避ける) */
  private _mouseDeltaBuf: THREE.Vector2 = new THREE.Vector2();
  private raycaster: THREE.Raycaster;
  private hoveredPlane: DomPlane | null;
  private domPlaneMeshes: THREE.Mesh[] = [];
  private postEffect: EffectLike | null = null;
  private internalComposer: EffectComposer | null = null;
  private effects: BaseEffect[] = [];
  private stats: Stats | null = null;
  /**
   * lil-gui の root インスタンス。
   * showGUI が false なら null のまま。最初の `setupGUI` を持つ effect が
   * `addEffect()` 経由で登録された瞬間に生成する（lazy + dynamic import）。
   */
  private gui: GUI | null = null;
  /**
   * lil-gui の dynamic import promise。複数 effect の addEffect が同時に来た時、
   * 二重 load を防ぐ。一度 resolve したら次回以降は `this.gui` を直接返す。
   */
  private _guiLoadPromise: Promise<GUI> | null = null;
  /**
   * destroy 済みフラグ。animate() 実行中に user callback から destroy() が
   * 呼ばれると、renderer.dispose() 後の続きで renderer.render() を呼んで
   * WebGL エラーになる。各段階の冒頭で見て早期 return する。
   */
  private destroyed: boolean = false;

  constructor(selector: string | HTMLElement, options: WebGLAppOptions = {}) {
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
    this.options = { enableMouseTracking: true, showGUI: true, ...options };
    this.mouse = new THREE.Vector2(0.5, 0.5);
    this.prevMouse = new THREE.Vector2(0.5, 0.5);
    this.raycaster = new THREE.Raycaster();
    this.hoveredPlane = null;

    // ScrollSync の初期化（renderer/camera生成後、init前に実行）
    if (options.scrollSync) {
      const syncOptions: ScrollSyncOptions =
        typeof options.scrollSync === 'object' ? options.scrollSync : {};
      this.scrollSync = new ScrollSync(this.container, syncOptions);
      // ScrollSync有効時はlogicalRectを使用
      this.rect = this.scrollSync.logicalRect;
      // 旧 architecture では `setResizeCallback` 経由で padding clamp 起因の canvas
      // resize を Core に通知していたが、fixed container 化で canvas サイズは window
      // resize 以外で変わらない。window resize は Core 側で直接 handle するので
      // ここで callback を繋ぐ必要は無い。
    }

    // renderer/cameraを正しいrectでセットアップ
    this.init();

    // stats.js の FPS パネル (optional peer)。dynamic import なので
    // showStats: false の利用者は stats.js をインストールする必要がない。
    // animate() 内の begin/end は optional chaining なので、load 完了前は no-op で安全。
    if (options.showStats) {
      void import('stats.js').then(({ default: StatsCtor }) => {
        if (this.destroyed) return;
        this.stats = new StatsCtor();
        this.stats.showPanel(0); // 0: fps, 1: ms, 2: mb
        // 同一ページに複数 WebGLApp を置くと panel が重なるので、
        // 呼び出し側で statsParent を指定すれば任意要素にぶら下げられる。
        (options.statsParent ?? document.body).appendChild(this.stats.dom);
      }).catch((err) => {
        console.warn(
          '[WebGLApp] showStats: true ですが stats.js が読み込めませんでした。' +
          'npm install stats.js してください。',
          err,
        );
      });
    }

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
    return this.mouse;
  }

  // 前回のマウス座標を取得（UV座標: 0~1）
  getPrevMouse() {
    return this.prevMouse;
  }

  // マウス移動量を取得。内部スクラッチを使い回すので、保持したい場合は呼び出し側で clone する。
  getMouseDelta() {
    return this._mouseDeltaBuf.copy(this.mouse).sub(this.prevMouse);
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
      throw new Error('[WebGLApp] createPlane(): destroy 済みのインスタンスでは使えません。');
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
      this.renderer,
      options,
      this.clock,
    );
    // plane.addEffect() からも GUI を生やせるよう WebGLApp の lazy-getter を渡す。
    // showGUI が false なら provider は渡さない（DomPlane 側で何もしない）。
    // lil-gui は optional peer の dynamic import なので Promise を返す provider。
    if (this.options.showGUI !== false) {
      domPlane._setGuiProvider(() => this._ensureGUIAsync());
    }
    this.domPlanes.push(domPlane);
    // element 無し (= フルスクリーン背景 plane) は raycast 候補から外す。
    // canvas 全面に重なるので element 付き plane と必ず distance 同値で衝突し、
    // stable sort で先勝ち → 後から push された DOM 連動 plane の hover を奪う。
    // 背景 plane は概念的に hover の対象ではないので最初から除外する。
    if (element) {
      this.domPlaneMeshes.push(domPlane.getMesh());
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
      const meshIndex = this.domPlaneMeshes.indexOf(domPlane.getMesh());
      if (meshIndex > -1) this.domPlaneMeshes.splice(meshIndex, 1);
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
      throw new Error('[WebGLApp] create3DObject(): destroy 済みのインスタンスでは使えません。');
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
      throw new Error('[WebGLApp] enableOrbitControls(): destroy 済みのインスタンスでは使えません。');
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
   * canvas 全体にエフェクトを追加する。
   * 内部で EffectComposer を自動生成するため、別途 setPostEffect は不要。
   *
   * **注意**: `setPostEffect()` でカスタム postEffect を入れている状態でこれを呼ぶと、
   * 自動生成された EffectComposer で上書きされる（カスタム postEffect の dispose は
   * 呼ばれない＝呼び出し側の責務）。両 API の併用は避けること。
   */
  addEffect<T extends BaseEffect>(effect: T): T {
    if (this.destroyed) {
      throw new Error('[WebGLApp] addEffect(): destroy 済みのインスタンスでは使えません。');
    }
    if (this.postEffect && this.postEffect !== this.internalComposer) {
      const msg =
        '[WebGLApp] addEffect() を呼ぶ前に setPostEffect() でカスタム postEffect が設定されています。' +
        '内部 EffectComposer で上書きします。カスタム postEffect は手動で dispose してください。';
      // DEV では事故防止のため throw（カスタム effect の dispose リークになるため）。
      if (import.meta.env?.DEV) throw new Error(msg);
      console.warn(msg);
    }
    if (!this.internalComposer) {
      this.internalComposer = new EffectComposer(
        this.renderer,
        this.rect.width,
        this.rect.height,
      );
      this.postEffect = this.internalComposer;
    }
    // renderer を要求するエフェクト（FluidEffect 等）に注入してから register する
    effect._setRenderer?.(this.renderer);
    effect._register(this.internalComposer);
    effect.resize?.(this.rect.width, this.rect.height);
    // setupGUI を実装している場合は自動で lil-gui パネルを生やす。
    // lil-gui は optional peer なので dynamic import の resolve を await してから呼ぶ。
    if (this.options.showGUI && effect.setupGUI) {
      this._ensureGUIAsync()
        .then((gui) => {
          if (this.destroyed) return;
          effect.setupGUI!(gui);
        })
        .catch((err) => {
          console.warn(
            '[WebGLApp] showGUI: true ですが lil-gui が読み込めませんでした。' +
            'npm install lil-gui してください。',
            err,
          );
        });
    }
    this.effects.push(effect);
    return effect;
  }

  /**
   * lil-gui を dynamic import で読み込み、root インスタンスを lazy 生成して返す。
   * 同時に複数 effect から呼ばれても load promise を共有して 1 インスタンスにまとめる。
   * @internal DomPlane.addEffect / WebGLApp.addEffect から呼ばれる。
   */
  _ensureGUIAsync(): Promise<GUI> {
    if (this.gui) return Promise.resolve(this.gui);
    if (!this._guiLoadPromise) {
      this._guiLoadPromise = import('lil-gui').then(({ default: GuiCtor }) => {
        if (!this.gui) {
          this.gui = new GuiCtor({ title: this.options.guiTitle ?? 'Effects' });
        }
        return this.gui;
      });
    }
    return this._guiLoadPromise;
  }

  /**
   * root の lil-gui インスタンスを取得 (sync)。
   *
   * **注意**: lil-gui は dynamic import で読み込むため、初回 effect 登録直後など
   * load 中の段階では `null` を返す。確実にインスタンスを得たい場合は
   * `getGUIAsync()` を使う。`showGUI: false` の場合は常に `null`。
   */
  getGUI(): GUI | null {
    if (this.options.showGUI === false) return null;
    return this.gui;
  }

  /**
   * lil-gui を必要に応じて load し、インスタンスを返す。
   * `showGUI: false` の場合は `null` を resolve する。
   */
  getGUIAsync(): Promise<GUI | null> {
    if (this.options.showGUI === false) return Promise.resolve(null);
    return this._ensureGUIAsync();
  }

  /**
   * ポストエフェクトを設定（低レベル API）。
   * 自前で `EffectLike`（render/resize/dispose）を実装したオブジェクトを差し込みたい場合のみ使用。
   * 通常は `addEffect()` を使うこと。
   *
   * **注意**: `addEffect()` で追加済みのエフェクトがある状態で呼ぶと、
   * 自動 EffectComposer を捨てて引数の postEffect に差し替える。既存 effect の
   * dispose は呼ばれない（必要なら先に `clearEffects()` を呼ぶこと）。
   */
  setPostEffect(postEffect: EffectLike): void {
    if (this.destroyed) {
      throw new Error('[WebGLApp] setPostEffect(): destroy 済みのインスタンスでは使えません。');
    }
    if (this.effects.length > 0) {
      const msg =
        '[WebGLApp] setPostEffect() が呼ばれましたが、addEffect() で追加した effect が既に存在します。' +
        '内部 EffectComposer を破棄してカスタム postEffect に差し替えます。' +
        '事前に clearEffects() を呼ぶことを推奨します。';
      if (import.meta.env?.DEV) throw new Error(msg);
      console.warn(msg);
      // 既存 effect の clean up（dispose まで）
      this.clearEffects();
    }
    this.postEffect = postEffect;
  }

  /**
   * `addEffect()` で登録した effect を 1 つ取り除く。
   *
   * - 内部 EffectComposer から該当 pass を外し、material を dispose する
   * - effect 自体の `dispose()` も呼ぶ（FluidEffect 等の RT も解放）
   * - 全 effect が空になった場合、internalComposer はそのまま残す（次の addEffect で再利用）
   *
   * 登録されていない effect を渡した時は `false` を返して何もしない。
   */
  removeEffect(effect: BaseEffect): boolean {
    if (this.destroyed) return false;
    const idx = this.effects.indexOf(effect);
    if (idx < 0) return false;
    this.effects.splice(idx, 1);
    const pass = effect.getPass();
    if (pass && this.internalComposer) {
      this.internalComposer.removeEffect(pass);
    }
    effect.dispose?.();
    return true;
  }

  /**
   * 登録されたエフェクトとポストエフェクトをすべて解除して破棄する。
   * addEffect で追加した全 effect の dispose() を呼び、内部 EffectComposer も解放する。
   */
  clearEffects(): void {
    if (this.destroyed) return;
    for (const effect of this.effects) {
      effect.dispose?.();
    }
    this.effects = [];
    this.postEffect?.dispose();
    this.postEffect = null;
    this.internalComposer = null;
  }

  /**
   * @deprecated `clearEffects()` を使ってください。挙動は同一です。
   */
  removePostEffect(): void {
    this.clearEffects();
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
      window.addEventListener('scroll', this.invalidateCanvasRect, {
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
   * mousemove tracking の動的な ON/OFF。
   * - true: 未 attach なら mousemove listener を追加する
   * - false: attach 済みなら detach する（hover も解除）
   *
   * `destroy()` 時は eventAbort と一緒に自動 detach される（_mouseAbort 個別 abort も呼ぶ）。
   */
  setMouseTrackingEnabled(enabled: boolean): void {
    if (this.destroyed) return;
    this.options.enableMouseTracking = enabled;
    if (enabled) {
      if (this._mouseAbort) return; // すでに attach 済み
      this._mouseAbort = new AbortController();
      window.addEventListener(
        'mousemove',
        (e: MouseEvent) => this.onMouseMove(e),
        { signal: this._mouseAbort.signal },
      );
    } else {
      this._mouseAbort?.abort();
      this._mouseAbort = null;
      this._mouseInside = false;
      if (this.hoveredPlane) {
        this.hoveredPlane.setHoverInfo(false, null);
        this.hoveredPlane = null;
      }
    }
  }

  private invalidateCanvasRect = (): void => {
    this._canvasRect = null;
  };

  /** mousemove 等で頻繁に必要な canvas viewport rect を遅延 + キャッシュで返す。 */
  private getCanvasRect(): DOMRect {
    if (!this._canvasRect) {
      this._canvasRect = this.canvas.getBoundingClientRect();
    }
    return this._canvasRect;
  }

  private onResize() {
    // canvas viewport rect は確実に変わるのでキャッシュを invalidate
    this._canvasRect = null;

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

    // ポストエフェクトのリサイズ
    this.postEffect?.resize(this.rect.width, this.rect.height);
    const effects = this.effects;
    for (let i = 0, n = effects.length; i < n; i++) {
      effects[i].resize?.(this.rect.width, this.rect.height);
    }

    // 登録された更新処理を実行
    const resizeCallbacks = this.resizeCallbacks;
    for (let i = 0, n = resizeCallbacks.length; i < n; i++) {
      resizeCallbacks[i]();
    }
  }

  /**
   * mousemove は **mouse 座標と canvas 内外フラグだけ** 更新する。
   * raycaster / setHoverInfo は呼ばない (= uMouseUV を直接書かない)。
   * uniform 更新は `_updateHoverFromMouse` 経由で rAF tick 内に集約することで、
   * paint と完全同期させ「mousemove 非同期発火による uMouseUV のちらつき」を防ぐ。
   */
  private onMouseMove(event: MouseEvent) {
    const rect = this.getCanvasRect();

    const isInside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    this._mouseInside = isInside;
    if (!isInside) return;

    this.mouse.x = (event.clientX - rect.left) / rect.width;
    this.mouse.y = 1.0 - (event.clientY - rect.top) / rect.height;
  }

  /**
   * rAF tick 内の Phase A で呼ばれる。最新の `this.mouse` を使って raycaster を投げ、
   * hover 中の plane を判定 + `setHoverInfo` (= uMouseUV / uIsHovered の更新) する。
   * mousemove イベントから切り離すことで全 plane の uniform が 1 tick = 1 確定値で
   * 揃い、paint と同期する。
   */
  private _updateHoverFromMouse(): void {
    if (!this.options.enableMouseTracking) return;
    if (this.domPlaneMeshes.length === 0) return;

    // canvas 外なら hover を解除
    if (!this._mouseInside) {
      if (this.hoveredPlane) {
        this.hoveredPlane.setHoverInfo(false, null);
        this.hoveredPlane = null;
      }
      return;
    }

    this._ndcBuf.set(this.mouse.x * 2 - 1, this.mouse.y * 2 - 1);
    this.raycaster.setFromCamera(this._ndcBuf, this.camera.instance);
    const intersects = this.raycaster.intersectObjects(this.domPlaneMeshes, false);

    if (intersects.length > 0) {
      const intersect = intersects[0];
      // domPlaneMeshes は domPlanes と index 1:1 対応していない
      // (element 無しの背景 plane は domPlaneMeshes に入っていない) ため、
      // mesh から対応する DomPlane を find で逆引きする。
      if (intersect.uv) {
        const hitMesh = intersect.object as THREE.Mesh;
        const plane = this.domPlanes.find((p) => p.getMesh() === hitMesh);
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

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.eventAbort.abort();
    this._mouseAbort?.abort();
    this._mouseAbort = null;

    this.domPlanes.forEach((plane) => plane.destroy());
    this.dom3DObjects.forEach((obj) => obj.destroy());
    this.domPlanes = [];
    this.dom3DObjects = [];
    this.domPlaneMeshes = [];
    this.updateCallbacks = [];
    this.resizeCallbacks = [];

    this.scrollSync?.destroy();
    this.scrollSync = null;

    for (const effect of this.effects) {
      effect.dispose?.();
    }
    this.effects = [];
    this.postEffect?.dispose();
    this.postEffect = null;
    this.internalComposer = null;
    this.controls?.dispose();
    this.controls = null;
    this.renderer.dispose();
    this.canvas.remove();

    if (this.stats) {
      this.stats.dom.remove();
      this.stats = null;
    }

    if (this.gui) {
      this.gui.destroy();
      this.gui = null;
    }
  }

  private animate = () => {
    if (this.destroyed) return;
    this.rafId = requestAnimationFrame(this.animate);
    this.stats?.begin();

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
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    // === Phase A: ユーザー callback + マウス hover 確定 + エフェクト update ===
    // raycaster + setHoverInfo を rAF tick 内で呼ぶことで uMouseUV / uIsHovered の
    // 更新タイミングが paint と揃う (mousemove 非同期発火に引きずられない)。
    this._updateHoverFromMouse();

    // DOM には触れないユーザー処理を先に消化する。
    // 登録された更新処理（ホットパスのため for ループで回す）
    const callbacks = this.updateCallbacks;
    for (let i = 0, n = callbacks.length; i < n; i++) {
      callbacks[i]();
    }

    const elapsed = this.clock.getElapsedTime();
    const effects = this.effects;
    for (let i = 0, n = effects.length; i < n; i++) {
      const effect = effects[i];
      if (!effect.enabled) continue;
      effect.update(elapsed, this.mouse);
    }

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
      planes[i]._tickRead();
    }
    for (let i = 0, n = objects.length; i < n; i++) {
      objects[i]._tickRead();
    }
    for (let i = 0, n = planes.length; i < n; i++) {
      planes[i].updateEffects(elapsed, this.mouse, scrollX, scrollY);
    }
    for (let i = 0, n = planes.length; i < n; i++) {
      planes[i]._tickApply(elapsed, scrollX, scrollY);
    }
    for (let i = 0, n = objects.length; i < n; i++) {
      objects[i]._tickApply(scrollX, scrollY);
    }

    // === Phase C: PlaneComposer の per-plane FBO レンダリング ===
    for (let i = 0, n = planes.length; i < n; i++) {
      planes[i]._tickRenderComposer();
    }

    // === Phase D: 本体レンダリング ===
    // user callback 内で destroy() が呼ばれている可能性があるので、
    // GL context を触る render はフラグを見てから。renderer.dispose() 後に
    // render を呼ぶと WebGL エラーになる。
    if (this.destroyed) {
      this.stats?.end();
      return;
    }
    if (this.postEffect) {
      // ポストエフェクトあり: シーン→FBO→エフェクト適用→キャンバス
      this.postEffect.render(this.scene, this.camera.instance);
    } else {
      // 通常レンダリング
      this.renderer.render(this.scene, this.camera.instance);
    }

    // フレームの最後にマウス座標を同期
    this.prevMouse.copy(this.mouse);

    this.stats?.end();
  };
}
