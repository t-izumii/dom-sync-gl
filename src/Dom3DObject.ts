import * as THREE from "three";
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
  private observer: IntersectionObserver | null;
  private destroyed: boolean;
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
          this.isVisible = entries[0].isIntersecting;
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
      this.positionCalculator.updatePositionInfo(scrollX, scrollY);
    }
  }

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
      (error: unknown) => {
        console.error(`Failed to load model: ${modelPath}`, error);
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
