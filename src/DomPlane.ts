import * as THREE from "three";
import type GUI from "lil-gui";
import type { CreatePlaneOptions } from "./types";
import { DomPositionCalculator } from "./DomPositionCalculator";
import { PlaneComposer } from "./PlaneComposer";
import type { BaseEffect } from "./effects/BaseEffect";
import { FeedbackBuffer, type FeedbackBufferOptions } from "./FeedbackBuffer";

export interface AddFeedbackOptions extends FeedbackBufferOptions {
  outputUniform: string;
}

const sharedTextureLoader = new THREE.TextureLoader();
sharedTextureLoader.setCrossOrigin("anonymous");

const defaultVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const defaultFragmentShader = `
  uniform sampler2D uTexture;
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    gl_FragColor = texColor;
  }
`;

export class DomPlane {
  element: HTMLElement | null;
  texture: THREE.Texture | null;
  mesh: THREE.Mesh;
  geometry: THREE.PlaneGeometry;
  material: THREE.ShaderMaterial;
  scene: THREE.Scene;
  clock: THREE.Clock;
  positionCalculator: DomPositionCalculator | null;
  canvasRect: DOMRect;
  isVisible: boolean;
  private updateRectEveryFrame: boolean;
  private observer: IntersectionObserver | null;
  private destroyed: boolean;
  private planeComposer: PlaneComposer | null = null;
  private renderer: THREE.WebGLRenderer;
  private effects: BaseEffect[] = [];
  private feedbacks: { buffer: FeedbackBuffer; outputUniform: string }[] = [];
  private readonly _feedbackMouseUV: THREE.Vector2 = new THREE.Vector2();
  private readonly _effectMouseUV: THREE.Vector2 = new THREE.Vector2();
  private gui: GUI | null = null;
  private ownsTexture: boolean = false;
  private crossOrigin: string | undefined;
  private readonly scroll: { x: number; y: number };

  constructor(
    el: HTMLElement | null,
    scene: THREE.Scene,
    canvasRect: DOMRect,
    scroll: { x: number; y: number },
    renderer: THREE.WebGLRenderer,
    options: CreatePlaneOptions = {},
    sharedClock?: THREE.Clock,
  ) {
    this.element = el;
    this.scene = scene;
    this.renderer = renderer;
    this.scroll = scroll;
    this.texture = null;
    this.destroyed = false;
    this.updateRectEveryFrame = options.updateRectEveryFrame || false;
    this.crossOrigin = options.crossOrigin;
    this.clock = sharedClock ?? new THREE.Clock();
    this.canvasRect = canvasRect;
    this.positionCalculator = el
      ? new DomPositionCalculator(el, canvasRect, this.scroll.x, this.scroll.y)
      : null;

    this.isVisible = !el;
    this.observer = null;
    if (el) {
      let hasEnteredView = false;
      const repeat = options.inViewRepeat ?? false;

      this.observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          this.isVisible = entry.isIntersecting;
          this.mesh.visible = this.isVisible;

          if (entry.isIntersecting) {
            if (options.onInView && (!hasEnteredView || repeat)) {
              hasEnteredView = true;
              options.onInView(this);
            }
          } else {
            if (repeat) {
              hasEnteredView = false;
              options.onOutView?.(this);
            }
          }
        },
        { rootMargin: options.inViewRootMargin ?? "100%" },
      );
      this.observer.observe(el);
    }

    const segments = options.segments ?? 1;
    this.geometry = new THREE.PlaneGeometry(1, 1, segments, segments);

    const uniforms = {
      uTexture: { value: null },
      uAlpha: { value: 1.0 },
      uResolution: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uIsHovered: { value: false },
      uMouseUV: { value: new THREE.Vector2(0, 0) },
      ...options.uniforms,
    };

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: uniforms,
      vertexShader: options.vertexShader || defaultVertexShader,
      fragmentShader: options.fragmentShader || defaultFragmentShader,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.visible = this.isVisible;

    this.scene.add(this.mesh);

    this.init();
  }

  public _tickRead(scrollX: number, scrollY: number): void {
    if (!this.isVisible || !this.positionCalculator) return;
    // position: sticky は stick 前後で挙動が変わり、rect のキャッシュが効かないため
    // updateRectEveryFrame の指定に関わらず毎フレーム読み直す。
    if (this.updateRectEveryFrame || this.positionCalculator.isSticky) {
      this.positionCalculator.updatePositionInfo(scrollX, scrollY);
    }
  }

  public _tickApply(elapsedTime: number, scrollX: number, scrollY: number): void {
    if (!this.isVisible) return;
    this.material.uniforms.uTime.value = elapsedTime;
    if (this.positionCalculator) {
      this.setPosition(scrollX, scrollY);
    }
  }

  public _tickRenderComposer(): void {
    if (!this.isVisible) return;
    this.planeComposer?.render();
  }

  private init() {
    this.loadTexture();
    this.resize();
  }

  protected loadTexture() {
    const texturePath = this.element?.getAttribute("data-texture");

    if (texturePath) {
      let loader: THREE.TextureLoader;
      if (this.crossOrigin !== undefined) {
        loader = new THREE.TextureLoader();
        loader.setCrossOrigin(this.crossOrigin);
      } else {
        loader = sharedTextureLoader;
      }
      loader.load(
        texturePath,
        (texture: THREE.Texture) => {
          if (this.destroyed) {
            texture.dispose();
            return;
          }
          this.texture = texture;
          this.ownsTexture = true;
          this.material.uniforms.uTexture.value = texture;
        },
        undefined,
        (error: unknown) => {
          console.error(`Failed to load texture: ${texturePath}`, error);
        },
      );
    } else if (this.material.uniforms.uTexture.value) {
      this.texture = this.material.uniforms.uTexture.value;
      this.ownsTexture = false;
    }
  }

  private updateSize() {
    if (this.positionCalculator) {
      const rect = this.positionCalculator.rect;
      this.mesh.scale.set(rect.width, rect.height, 1);
      this.material.uniforms.uResolution.value.set(rect.width, rect.height);
    } else {
      this.mesh.scale.set(this.canvasRect.width, this.canvasRect.height, 1);
      this.material.uniforms.uResolution.value.set(
        this.canvasRect.width,
        this.canvasRect.height,
      );
    }
  }

  private setPosition(scrollX: number, scrollY: number) {
    if (!this.positionCalculator) return;
    const { x, y } = this.positionCalculator.calculateWebGLPosition(
      scrollX,
      scrollY,
    );
    this.mesh.position.set(x, y, 0);
    // post effect 有効時、PlaneComposer が mesh を mainScene から外す（parent === null）ため、
    // レンダーループでの matrixWorld 自動更新が走らなくなる。PointerController のレイキャストは
    // mesh.matrixWorld を参照するので、ここで明示的に更新して常に最新の位置を反映させる。
    // scene 所属時（post effect 無し）でも無害（レンダー時に再計算されるだけ）。
    this.mesh.updateMatrixWorld();
  }

  public setCanvasRect(canvasRect: DOMRect) {
    this.canvasRect = canvasRect;
    if (this.positionCalculator) {
      this.positionCalculator.setCanvasRect(canvasRect);
    }
  }

  public resize() {
    if (this.positionCalculator) {
      const scrollX = this.scroll.x;
      const scrollY = this.scroll.y;

      this.positionCalculator.refreshPositionType();
      this.positionCalculator.updatePositionInfo(scrollX, scrollY);

      this.updateSize();
      this.setPosition(scrollX, scrollY);
    } else {
      this.updateSize();
      this.mesh.position.set(0, 0, 0);
      // setPosition() を通らない経路なので、ここでも matrixWorld を更新しておく
      // （post effect 有効時に mesh が scene から外れていても位置/スケールが反映されるように）。
      this.mesh.updateMatrixWorld();
    }

    if (this.planeComposer) {
      const rect = this.positionCalculator?.rect ?? this.canvasRect;
      this.planeComposer.resize(rect.width, rect.height);
      for (const effect of this.effects) {
        effect.resize?.(rect.width, rect.height);
      }
    }
  }

  public getMesh() {
    return this.mesh;
  }

  public reloadTexture(): void {
    if (this.texture && this.ownsTexture) {
      this.texture.dispose();
      this.texture = null;
      this.material.uniforms.uTexture.value = null;
      this.ownsTexture = false;
    }
    this.loadTexture();
  }

  public setTexture(texture: THREE.Texture, takeOwnership: boolean = false): void {
    if (this.texture && this.ownsTexture && this.texture !== texture) {
      this.texture.dispose();
    }
    this.texture = texture;
    this.ownsTexture = takeOwnership;
    this.material.uniforms.uTexture.value = texture;
  }

  public updateEffects(
    time: number,
    globalMouse: THREE.Vector2 | undefined,
    scrollX: number,
    scrollY: number,
  ) {
    if (this.effects.length === 0) return;

    if (globalMouse) {
      if (this.positionCalculator) {
        const pc = this.positionCalculator;
        const cr = this.canvasRect;
        const rectW = pc.rect.width;
        const rectH = pc.rect.height;
        if (cr.width > 0 && cr.height > 0 && rectW > 0 && rectH > 0) {
          const viewportLeft = pc.isFixed ? pc.pageLeft : pc.pageLeft - scrollX;
          const viewportTop = pc.isFixed ? pc.pageTop : pc.pageTop - scrollY;

          const planeLeft = (viewportLeft - cr.left) / cr.width;
          const planeTop = (viewportTop - cr.top) / cr.height;
          const planeW = rectW / cr.width;
          const planeH = rectH / cr.height;
          const planeBottomYup = 1 - planeTop - planeH;
          const lx = (globalMouse.x - planeLeft) / planeW;
          const ly = (globalMouse.y - planeBottomYup) / planeH;

          if (lx >= 0 && lx <= 1 && ly >= 0 && ly <= 1) {
            this.material.uniforms.uMouseUV.value.set(lx, ly);
          }
        }
      } else {
        this.material.uniforms.uMouseUV.value.copy(globalMouse);
      }
    }

    const uniformUV = this.material.uniforms.uMouseUV.value as THREE.Vector2;
    this._effectMouseUV.copy(uniformUV);
    const effects = this.effects;
    for (let i = 0, n = effects.length; i < n; i++) {
      const effect = effects[i];
      if (!effect.enabled) continue;
      effect.update(time, this._effectMouseUV);
    }
  }

  public getMouseUV(): THREE.Vector2 {
    return this.material.uniforms.uMouseUV.value as THREE.Vector2;
  }

  public isHovered(): boolean {
    return this.material.uniforms.uIsHovered.value as boolean;
  }

  public setHoverInfo(isHovered: boolean, uv: THREE.Vector2 | null) {
    this.material.uniforms.uIsHovered.value = isHovered;
    if (uv) {
      this.material.uniforms.uMouseUV.value.copy(uv);
    }
  }

  private enableEffects(): PlaneComposer {
    if (this.planeComposer) return this.planeComposer;
    const rect = this.positionCalculator?.rect ?? this.canvasRect;
    this.planeComposer = new PlaneComposer(
      this.renderer,
      this.mesh,
      this.scene,
      rect.width,
      rect.height,
    );
    return this.planeComposer;
  }

  public addEffect<T extends BaseEffect>(effect: T): T {
    const composer = this.enableEffects();
    effect._setRenderer?.(this.renderer);
    effect._register(composer);
    const rect = this.positionCalculator?.rect ?? this.canvasRect;
    effect.resize?.(rect.width, rect.height);
    if (this.gui && effect.setupGUI) {
      const folder = effect.setupGUI(this.gui);
      if (folder) effect._attachGUI(folder);
    }
    this.effects.push(effect);
    return effect;
  }

  public addFeedback(options: AddFeedbackOptions): FeedbackBuffer {
    const buffer = new FeedbackBuffer(this.renderer, options);
    if (!this.material.uniforms[options.outputUniform]) {
      this.material.uniforms[options.outputUniform] = { value: null };
    }
    this.material.uniforms[options.outputUniform].value = buffer.texture;
    this.feedbacks.push({ buffer, outputUniform: options.outputUniform });
    if (this.gui && options.setupGUI) {
      const folder = options.setupGUI(this.gui, buffer);
      if (folder) buffer._attachGUI(folder);
    }
    return buffer;
  }

  public removeFeedback(buffer: FeedbackBuffer): boolean {
    const idx = this.feedbacks.findIndex((f) => f.buffer === buffer);
    if (idx < 0) return false;
    const { outputUniform } = this.feedbacks[idx];
    this.feedbacks.splice(idx, 1);
    if (this.material.uniforms[outputUniform]) {
      this.material.uniforms[outputUniform].value = null;
    }
    buffer.dispose();
    return true;
  }

  public _tickFeedback(elapsedTime: number): void {
    if (!this.isVisible || this.feedbacks.length === 0) return;
    const rect = this.positionCalculator?.rect ?? this.canvasRect;
    const aspect = rect.height > 0 ? rect.width / rect.height : 1;
    const hover = this.material.uniforms.uIsHovered.value ? 1 : 0;
    this._feedbackMouseUV.copy(
      this.material.uniforms.uMouseUV.value as THREE.Vector2,
    );
    for (let i = 0, n = this.feedbacks.length; i < n; i++) {
      const f = this.feedbacks[i];
      const tex = f.buffer.step({
        mouse: this._feedbackMouseUV,
        hover,
        time: elapsedTime,
        aspect,
      });
      this.material.uniforms[f.outputUniform].value = tex;
    }
  }

  public removeEffect(effect: BaseEffect): boolean {
    const idx = this.effects.indexOf(effect);
    if (idx < 0) return false;
    this.effects.splice(idx, 1);
    const pass = effect.getPass();
    if (pass && this.planeComposer) {
      this.planeComposer.removeEffect(pass);
    }
    effect._dispose();
    return true;
  }

  public _setGui(gui: GUI | null): void {
    this.gui = gui;
  }

  public destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.observer?.disconnect();

    for (const effect of this.effects) {
      effect._dispose();
    }
    this.effects = [];

    for (const f of this.feedbacks) {
      f.buffer.dispose();
    }
    this.feedbacks = [];

    if (this.planeComposer) {
      this.planeComposer.dispose();
      this.planeComposer = null;
    }
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    if (this.texture && this.ownsTexture) {
      this.texture.dispose();
    }
    this.texture = null;
  }
}
