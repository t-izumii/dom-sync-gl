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

// DomPlane が内部で生成・毎フレーム更新する uniform。
// options.uniforms からの上書きは内部処理を壊すため予約名として禁止する。
const RESERVED_UNIFORM_NAMES: readonly string[] = [
  "uTexture",
  "uAlpha",
  "uResolution",
  "uTime",
  "uIsHovered",
  "uMouseUV",
];

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
  private textureColorSpace: THREE.ColorSpace;
  // 進行中の非同期テクスチャロードの世代番号。reload/setTexture/destroy で
  // インクリメントし、後着した古いロードの完了 callback を無効化する。
  private textureLoadGeneration = 0;
  private readonly scroll: { x: number; y: number };
  // destroy() 直接呼び出しでも Core の registry から解除できるよう、生成元が
  // 登録する解除 callback。destroy() 冒頭で一度だけ呼んで null に戻す。
  private onDestroy: (() => void) | null = null;

  constructor(
    el: HTMLElement | null,
    scene: THREE.Scene,
    canvasRect: DOMRect,
    scroll: { x: number; y: number },
    renderer: THREE.WebGLRenderer,
    options: CreatePlaneOptions = {},
    sharedClock?: THREE.Clock,
  ) {
    if (options.uniforms) {
      for (const name of RESERVED_UNIFORM_NAMES) {
        if (name in options.uniforms) {
          throw new Error(
            `[DomPlane] uniform "${name}" は予約済みで内部管理されます。` +
              `options.uniforms から渡さないでください（予約名: ${RESERVED_UNIFORM_NAMES.join(", ")}）。`,
          );
        }
      }
    }

    this.element = el;
    this.scene = scene;
    this.renderer = renderer;
    this.scroll = scroll;
    this.texture = null;
    this.destroyed = false;
    this.updateRectEveryFrame = options.updateRectEveryFrame || false;
    this.crossOrigin = options.crossOrigin;
    this.textureColorSpace = options.textureColorSpace ?? THREE.NoColorSpace;
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
      const generation = this.textureLoadGeneration;
      loader.load(
        texturePath,
        (texture: THREE.Texture) => {
          // 後着した古いロード結果は表示の巻き戻りを防ぐため破棄する
          if (this.destroyed || generation !== this.textureLoadGeneration) {
            texture.dispose();
            return;
          }
          texture.colorSpace = this.textureColorSpace;
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
    // PointerController のレイキャストは mesh.matrixWorld を参照し、フレーム内では
    // この apply より前（レンダーより前）に走る。レンダーループの自動更新に頼ると
    // scene.matrixWorldAutoUpdate 無効時に古い座標で判定してしまうため、位置確定と
    // 同時にここで更新して hover 判定を常に最新に保つ。
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
      // setPosition() を通らない経路なので、同じ理由（hover 判定を最新に保つ）で
      // ここでも matrixWorld を更新しておく。
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
    this.textureLoadGeneration++;
    if (this.texture && this.ownsTexture) {
      this.texture.dispose();
      this.texture = null;
      this.material.uniforms.uTexture.value = null;
      this.ownsTexture = false;
    }
    this.loadTexture();
  }

  public setTexture(texture: THREE.Texture, takeOwnership: boolean = false): void {
    this.textureLoadGeneration++;
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
    if (RESERVED_UNIFORM_NAMES.includes(options.outputUniform)) {
      throw new Error(
        `[DomPlane] addFeedback の outputUniform "${options.outputUniform}" は` +
          `予約済み uniform 名で内部管理されます。別の名前を指定してください` +
          `（予約名: ${RESERVED_UNIFORM_NAMES.join(", ")}）。`,
      );
    }
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
    // 最後の effect が外れたら RenderTarget を抱えたままにせず解放する。
    // dispose() は material を元へ戻すので、次の addEffect で composer を再生成できる。
    if (this.effects.length === 0 && this.planeComposer) {
      this.planeComposer.dispose();
      this.planeComposer = null;
    }
    return true;
  }

  public _setGui(gui: GUI | null): void {
    this.gui = gui;
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
    this.textureLoadGeneration++;
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
