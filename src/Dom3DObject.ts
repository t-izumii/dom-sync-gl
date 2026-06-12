import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DomPositionCalculator } from "./DomPositionCalculator";
import type { Create3DObjectOptions } from "./types";
import { DEFAULT_SCALE, DEFAULT_OFFSET } from "./constants";

/**
 * DOM 要素の位置・サイズに合わせて GLTF モデルを配置するクラス。
 *
 * **element の扱い**:
 * - `HTMLElement` 指定: DOM 要素位置に追従。bbox 正規化と DOM サイズに対する scale
 *   フィットを行う。
 * - `null` 指定: scene 原点に固定（モデル本来のサイズ × userScale）。
 *   ScrollSync 無効時はそのまま viewport 中心に固定される。
 *   ScrollSync 有効時でも Lenis 等で JS rAF と paint の scrollY が同一に揃っていれば
 *   container が viewport に厳密固定され、scene 原点固定 obj も viewport 上で
 *   ズレなく見える。
 *
 * **エフェクトについて**: `DomPlane` と異なり `addEffect()` API は持たない。
 * 任意 3D モデル単体に局所ポストエフェクトを当てるのは Plane と違って
 * 1) 任意視点からの再投影が必要、2) 透視テクスチャ再貼り付けでクオリティが落ちる
 * といった問題があり、汎用化が難しいため意図的に提供していない。
 *
 * モデル全体に効くエフェクトを掛けたい場合は `WebGLApp.addEffect()` で
 * 画面全体のポストエフェクトとして適用する。
 * モデル個別にエフェクトが必要な場合は `getModel()` で `THREE.Group` を取り出し、
 * カスタムマテリアル/シェーダーで対応すること。
 *
 * **IntersectionObserver について**: `DomPlane` と違い `onInView` / `onOutView` /
 * `inViewRepeat` / `inViewRootMargin` は提供していない。Dom3DObject は GLTF を
 * scene に置く性質上「画面外で非表示にして無駄な描画を避ける」用途に絞られ、
 * 進行状況通知やリセット系のコールバックは Plane より使い所が薄いため。
 * 必要なら利用側で `getModel()` を取り出して自前で IntersectionObserver を組む。
 * element=null の場合は IntersectionObserver は作らない（常に表示）。
 */
export class Dom3DObject {
  element: HTMLElement | null;
  model: THREE.Group | null;
  loader: GLTFLoader;
  mainScene: THREE.Scene;
  canvasRect: DOMRect;
  options: Create3DObjectOptions;
  isVisible: boolean;
  private positionCalculator: DomPositionCalculator | null;
  private updateRectEveryFrame: boolean;
  private observer: IntersectionObserver | null;
  private destroyed: boolean;
  /**
   * Core が保持する確定スクロール値キャッシュへの live 参照。
   * 単発イベント経路（ctor の初期位置算出・setupModel・resize）はこの値を読み、
   * `window.scrollX/Y` を直読みしない。setupModel は GLTF load 完了後に非同期で走るため、
   * スナップショットではなく live 参照を保持して最新値を読む必要がある。
   */
  private readonly scroll: { x: number; y: number };

  constructor(
    element: HTMLElement | null,
    mainScene: THREE.Scene,
    canvasRect: DOMRect,
    scroll: { x: number; y: number },
    options: Create3DObjectOptions,
  ) {
    this.element = element;
    this.mainScene = mainScene;
    this.canvasRect = canvasRect;
    this.scroll = scroll;
    this.model = null;
    this.loader = new GLTFLoader();
    this.options = {
      scale: DEFAULT_SCALE,
      // DEFAULT_OFFSET をそのまま参照すると、複数 Dom3DObject インスタンスが
      // 同一オブジェクトを共有してしまう。誰かが `obj.options.offset.x = 5` で
      // 書き換えると DEFAULT_OFFSET 自身が変わり、以後の全インスタンスに伝播する。
      // インスタンスごとに copy して隔離する。
      offset: { ...DEFAULT_OFFSET },
      ...options,
    };
    this.updateRectEveryFrame = options.updateRectEveryFrame ?? false;
    this.positionCalculator = element
      ? new DomPositionCalculator(element, canvasRect, this.scroll.x, this.scroll.y)
      : null;
    // element=null は scene 原点固定で常に表示。HTMLElement の場合は Observer の
    // 初回 callback まで非表示にして「初フレ画面外で見える」を避ける。
    this.isVisible = !element;
    this.destroyed = false;
    this.observer = null;

    if (element) {
      this.observer = new IntersectionObserver(
        (entries) => {
          this.isVisible = entries[0].isIntersecting;
          if (this.model) this.model.visible = this.isVisible;
        },
        { rootMargin: '100%' },
      );
      this.observer.observe(element);
    }

    // 毎フレームの位置追従は Core.animate から _tickRead → _tickApply の順に直接呼ばれる。
    this.loadModel();
  }

  /**
   * Phase B-read (DOM read): getBoundingClientRect のみ。
   * Core.animate で paint 直前にまとめて呼ばれる。
   * element=null の場合は何もしない（scene 原点固定で DOM 追従不要）。
   *
   * **更新条件**: `updateRectEveryFrame: true` のときのみ毎フレ更新。
   * 自身の CSS animation で動的に位置が変わるケースのみ true に。
   * (旧仕様では isFixed で自動毎フレ更新していたが、多くの場合不要な layout 強制
   *  になっていたため明示フラグ駆動に変更)
   * @internal Core.animate から呼ばれる。
   */
  public _tickRead(scrollX: number, scrollY: number): void {
    if (!this.model || !this.isVisible || !this.positionCalculator) return;
    if (this.updateRectEveryFrame) {
      this.positionCalculator.updatePositionInfo(scrollX, scrollY);
    }
  }

  /**
   * Phase B-apply: model.position の書き込み。
   * DOM あり/なしどちらでも `setPosition` を呼ぶ。setPosition 内部で positionCalculator の
   * null を扱うため、DOM なしは offset のみ反映される（後から options.offset を書き換えても
   * 毎フレ反映される一貫性を担保）。
   * @internal Core.animate から呼ばれる。
   */
  public _tickApply(scrollX: number, scrollY: number): void {
    if (!this.model || !this.isVisible) return;
    this.setPosition(scrollX, scrollY);
  }

  private loadModel() {
    const modelPath = this.options.modelPath;

    if (!modelPath) {
      console.error("Dom3DObject: modelPath が指定されていません。");
      return;
    }

    this.loader.load(
      modelPath,
      (gltf: GLTF) => {
        if (this.destroyed) return;
        this.model = gltf.scene;
        this.setupModel();
      },
      undefined,
      // GLTFLoader の onError は ProgressEvent / ErrorEvent / Error など複数型を渡してくる。
      // ErrorEvent 固定で受けると `.message` が undefined のケースで static 型上の嘘になる。
      (error: unknown) => {
        console.error(`Failed to load model: ${modelPath}`, error);
      },
    );
  }

  private setupModel(): void {
    if (!this.model) return;

    // DOMありの場合のみ bbox で正規化（DOMサイズに合わせるため）。
    // DOMなしはモデルのデフォルトサイズをそのまま使う（scene 原点固定）。
    if (this.positionCalculator) {
      // DomPositionCalculator constructor で遅延した位置タイプ判定 (getComputedStyle)
      // をここで実行 + rect 再取得。load 完了後の初期化なので layout 1 回。
      this.positionCalculator.refreshPositionType();
      // GLTF load 完了後（非同期）に走るため、Core の live キャッシュから最新値を読む。
      this.positionCalculator.updatePositionInfo(this.scroll.x, this.scroll.y);

      const box = new THREE.Box3().setFromObject(this.model);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      const maxSide = Math.max(size.x, size.y, size.z) || 1;
      const inner = this.model;
      inner.position.sub(center).multiplyScalar(1 / maxSide);
      inner.scale.multiplyScalar(1 / maxSide);

      const wrapper = new THREE.Group();
      wrapper.add(inner);
      this.model = wrapper;
    }

    this.model.visible = this.isVisible;
    this.mainScene.add(this.model);

    this.applyScale();
    this.setPosition(this.scroll.x, this.scroll.y);
  }

  private applyScale(): void {
    if (!this.model) return;
    const userScale = this.options.scale ?? DEFAULT_SCALE;

    if (this.positionCalculator) {
      // DOMあり: DOM要素サイズに合わせる（bbox正規化済み）
      const { width, height } = this.positionCalculator.rect;
      const fitMode = this.options.fitMode ?? "maxSide";
      const domScale =
        fitMode === "contain" ? Math.min(width, height) : Math.max(width, height);
      const finalScale = domScale * userScale;
      this.model.scale.set(finalScale, finalScale, finalScale);
    } else {
      // DOMなし: モデルのデフォルトサイズ + userScale のみ
      this.model.scale.set(userScale, userScale, userScale);
    }
  }

  private setPosition(scrollX: number, scrollY: number): void {
    if (!this.model) return;

    // constructor で `offset: { ...DEFAULT_OFFSET }` を必ず展開しているので
    // 常に non-null。`??` のフォールバックは不要。
    const offset = this.options.offset!;
    let x = offset.x;
    let y = offset.y;
    const z = offset.z;

    if (this.positionCalculator) {
      const pos = this.positionCalculator.calculateWebGLPosition(scrollX, scrollY);
      x += pos.x;
      y += pos.y;
    }

    this.model.position.set(x, y, z);
  }

  public setCanvasRect(canvasRect: DOMRect) {
    this.canvasRect = canvasRect;
    this.positionCalculator?.setCanvasRect(canvasRect);
  }

  public resize() {
    if (!this.positionCalculator) {
      // DOMなしの場合は scale を userScale だけで再適用 (DOM サイズ依存なし)
      this.applyScale();
      return;
    }
    this.positionCalculator.refreshPositionType();
    // Core が確定したキャッシュ値を読む（window 直読みはしない）。
    this.positionCalculator.updatePositionInfo(this.scroll.x, this.scroll.y);
    this.applyScale();
    this.setPosition(this.scroll.x, this.scroll.y);
  }

  public getModel() {
    return this.model;
  }

  public destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.observer?.disconnect();

    if (this.model) {
      this.mainScene.remove(this.model);

      this.model.traverse((child: THREE.Object3D) => {
        if (!(child as THREE.Mesh).isMesh) return;
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of materials) {
          if (!m) continue;
          disposeMaterialTextures(m);
          m.dispose();
        }
      });
      this.model = null;
    }
  }
}

/**
 * Material が持つテクスチャ系プロパティを列挙して dispose する。
 * three.js の `Material.dispose()` は texture を一緒に dispose してくれないので
 * 自前で解放しないと GPU メモリにテクスチャが残り続ける。
 *
 * 一般的な PBR / Standard / Basic 系で使われるテクスチャキーを網羅する。
 */
function disposeMaterialTextures(material: THREE.Material): void {
  const textureKeys = [
    "map",
    "alphaMap",
    "aoMap",
    "bumpMap",
    "displacementMap",
    "emissiveMap",
    "envMap",
    "lightMap",
    "metalnessMap",
    "normalMap",
    "roughnessMap",
    "specularMap",
    "clearcoatMap",
    "clearcoatNormalMap",
    "clearcoatRoughnessMap",
    "sheenColorMap",
    "sheenRoughnessMap",
    "transmissionMap",
    "thicknessMap",
    "iridescenceMap",
    "iridescenceThicknessMap",
    "anisotropyMap",
    "matcap",
    "gradientMap",
  ] as const;
  const m = material as unknown as Record<string, unknown>;
  for (const key of textureKeys) {
    const value = m[key];
    if (value && (value as THREE.Texture).isTexture) {
      (value as THREE.Texture).dispose();
    }
  }
}
