import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DomPositionCalculator } from "./DomPositionCalculator";
import type { Create3DObjectOptions } from "./types";
import { DEFAULT_SCALE, DEFAULT_OFFSET } from "./constants";

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
  private sizeDirty = false;
  private observer: IntersectionObserver | null;
  private destroyed: boolean;
  private readonly scroll: { x: number; y: number };
  // destroy() 直接呼び出しでも Core の registry から解除できるよう、生成元が
  // 登録する解除 callback。destroy() 冒頭で一度だけ呼んで null に戻す。
  private onDestroy: (() => void) | null = null;

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
      offset: { ...DEFAULT_OFFSET },
      ...options,
    };
    this.updateRectEveryFrame = options.updateRectEveryFrame ?? false;
    this.positionCalculator = element
      ? new DomPositionCalculator(element, canvasRect, this.scroll.x, this.scroll.y)
      : null;
    this.isVisible = !element;
    this.destroyed = false;
    this.observer = null;

    if (element) {
      this.observer = new IntersectionObserver(
        (entries) => {
          if (this.destroyed || entries.length === 0) return;
          this.isVisible = entries[entries.length - 1].isIntersecting;
          if (this.model) this.model.visible = this.isVisible;
        },
        { rootMargin: '100%' },
      );
      this.observer.observe(element);
    }

    this.loadModel();
  }

  public _tickRead(scrollX: number, scrollY: number): void {
    if (!this.model || !this.isVisible || !this.positionCalculator) return;
    // position: sticky は stick 前後で挙動が変わり、rect のキャッシュが効かないため
    // updateRectEveryFrame の指定に関わらず毎フレーム読み直す。
    if (this.updateRectEveryFrame || this.positionCalculator.isSticky) {
      const { width, height } = this.positionCalculator.rect;
      this.positionCalculator.updatePositionInfo(scrollX, scrollY);
      const rect = this.positionCalculator.rect;
      this.sizeDirty ||= width !== rect.width || height !== rect.height;
    }
  }

  public _tickApply(scrollX: number, scrollY: number): void {
    if (!this.model || !this.isVisible) return;
    if (this.sizeDirty) {
      this.sizeDirty = false;
      this.applyScale();
    }
    this.setPosition(scrollX, scrollY);
  }

  private loadModel() {
    const modelPath = this.options.modelPath;

    if (!modelPath) {
      console.error("[Dom3DObject] modelPath is not specified.");
      return;
    }

    this.loader.load(
      modelPath,
      (gltf: GLTF) => {
        if (this.destroyed) {
          disposeModel(gltf.scene);
          return;
        }
        this.model = gltf.scene;
        this.setupModel();
      },
      undefined,
      (error: unknown) => {
        console.error(`[Dom3DObject] Failed to load model: ${modelPath}`, error);
      },
    );
  }

  private setupModel(): void {
    if (!this.model) return;

    if (this.positionCalculator) {

      this.positionCalculator.refreshPositionType();

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
      const { width, height } = this.positionCalculator.rect;
      const fitMode = this.options.fitMode ?? "maxSide";
      const domScale =
        fitMode === "contain" ? Math.min(width, height) : Math.max(width, height);
      const finalScale = domScale * userScale;
      this.model.scale.set(finalScale, finalScale, finalScale);
    } else {
      this.model.scale.set(userScale, userScale, userScale);
    }
  }

  private setPosition(scrollX: number, scrollY: number): void {
    if (!this.model) return;

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
    this.sizeDirty = false;
    if (!this.positionCalculator) {
      this.applyScale();
      return;
    }
    this.positionCalculator.refreshPositionType();
    this.positionCalculator.updatePositionInfo(this.scroll.x, this.scroll.y);
    this.applyScale();
    this.setPosition(this.scroll.x, this.scroll.y);
  }

  public getModel() {
    return this.model;
  }

  public _setOnDestroy(cb: (() => void) | null): void {
    this.onDestroy = cb;
  }

  public destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    const onDestroy = this.onDestroy;
    this.onDestroy = null;
    onDestroy?.();
    this.observer?.disconnect();

    if (this.model) {
      this.mainScene.remove(this.model);

      disposeModel(this.model);
      this.model = null;
    }
  }
}

function disposeModel(model: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  model.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material) materials.add(material);
    }
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) skeletons.add((mesh as THREE.SkinnedMesh).skeleton);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
  for (const material of materials) {
    collectMaterialTextures(material, textures);
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
}

function collectMaterialTextures(material: THREE.Material, textures: Set<THREE.Texture>): void {
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
      textures.add(value as THREE.Texture);
    }
  }
}
