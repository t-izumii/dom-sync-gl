import * as THREE from "three/webgpu";
import { texture, uniform, uv } from "three/tsl";
import type { TextureNode, UniformNode } from "three/webgpu";
import type GUI from "lil-gui";
import type { CreatePlaneOptions, PlaneNodeContext } from "./types";
import { DomPositionCalculator } from "./DomPositionCalculator";
import { PlaneComposer } from "./PlaneComposer";
import type { BaseEffect } from "./effects/BaseEffect";
import { FeedbackBuffer, type FeedbackBufferOptions } from "./FeedbackBuffer";
import { MouseMotion } from "./MouseMotion";

export interface AddFeedbackOptions extends FeedbackBufferOptions {
  outputUniform: string;
}

const sharedTextureLoader = new THREE.TextureLoader();
sharedTextureLoader.setCrossOrigin("anonymous");

// DomPlane が内部で生成・毎フレーム更新するノード名。
// options.uniforms からの上書きは内部処理を壊すため予約名として禁止する。
const RESERVED_UNIFORM_NAMES: readonly string[] = [
  "uTexture",
  "uAlpha",
  "uResolution",
  "uTime",
  "uIsHovered",
  "uMouseUV",
  "uPrevMouse",
  "uMove",
];

// テクスチャ未設定でも texture() ノードは有効な Texture を要求するため、
// 全 plane で共有する 1x1 透明テクスチャを初期値に使う。
const placeholderTexture = new THREE.DataTexture(
  new Uint8Array([0, 0, 0, 0]),
  1,
  1,
);
placeholderTexture.needsUpdate = true;

export class DomPlane {
  element: HTMLElement | null;
  texture: THREE.Texture | null;
  mesh: THREE.Mesh;
  geometry: THREE.PlaneGeometry;
  material: THREE.MeshBasicNodeMaterial;
  scene: THREE.Scene;
  clock: THREE.Clock;
  positionCalculator: DomPositionCalculator | null;
  canvasRect: DOMRect;
  isVisible: boolean;
  private updateRectEveryFrame: boolean;
  private observer: IntersectionObserver | null;
  private destroyed: boolean;
  private planeComposer: PlaneComposer | null = null;
  private renderer: THREE.WebGPURenderer;
  private effects: BaseEffect[] = [];
  private feedbacks: { buffer: FeedbackBuffer; outputUniform: string }[] = [];
  private readonly _feedbackMouseUV: THREE.Vector2 = new THREE.Vector2();
  private readonly _effectMouseUV: THREE.Vector2 = new THREE.Vector2();
  private gui: GUI | null = null;
  // BaseEffect / FeedbackBuffer は _attachGUI() で自分のフォルダを持てるが、
  // plane の setupGUI には対応するオブジェクトが無いため plane 自身が所有する。
  private setupGUIHook: CreatePlaneOptions["setupGUI"];
  private _guiFolder: GUI | null = null;
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

  // colorNode / positionNode から参照される内部ノード。構築後はノードグラフを
  // 組み替えず `.value` の差し替えのみで毎フレーム更新する。
  private readonly nodes: {
    uTexture: TextureNode;
    uAlpha: UniformNode<number>;
    uResolution: UniformNode<THREE.Vector2>;
    uTime: UniformNode<number>;
    uIsHovered: UniformNode<number>;
    uMouseUV: UniformNode<THREE.Vector2>;
    uPrevMouse: UniformNode<THREE.Vector2>;
    uMove: UniformNode<number>;
  };
  private readonly _mouseMotion = new MouseMotion();
  private readonly userUniforms: Record<string, UniformNode<unknown>>;
  // uIsHovered は shader 向けに float(0/1) で持つため、JS 向けの真偽値は別に持つ。
  private _isHovered = false;

  constructor(
    el: HTMLElement | null,
    scene: THREE.Scene,
    canvasRect: DOMRect,
    scroll: { x: number; y: number },
    renderer: THREE.WebGPURenderer,
    options: CreatePlaneOptions = {},
    sharedClock?: THREE.Clock,
    canvasViewportFixed: boolean = true,
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
    // gui は生成元が構築後に _setGui() で注入するため、実行は _setGui() まで遅らせる。
    this.setupGUIHook = options.setupGUI;
    // 既定 SRGBColorSpace の理由は types.ts の textureColorSpace JSDoc を参照。
    this.textureColorSpace = options.textureColorSpace ?? THREE.SRGBColorSpace;
    this.clock = sharedClock ?? new THREE.Clock();
    this.canvasRect = canvasRect;
    this.positionCalculator = el
      ? new DomPositionCalculator(el, canvasRect, this.scroll.x, this.scroll.y, canvasViewportFixed)
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

    const uTexture = texture(placeholderTexture);
    const uAlpha = uniform(1.0);
    const uResolution = uniform(new THREE.Vector2());
    const uTime = uniform(0);
    const uIsHovered = uniform(0);
    const uMouseUV = uniform(new THREE.Vector2(0, 0));
    const uPrevMouse = uniform(new THREE.Vector2(0, 0));
    const uMove = uniform(0);
    this.nodes = {
      uTexture,
      uAlpha,
      uResolution,
      uTime,
      uIsHovered,
      uMouseUV,
      uPrevMouse,
      uMove,
    };
    this.userUniforms = { ...options.uniforms };

    const ctx: PlaneNodeContext = {
      uTexture,
      uAlpha,
      uResolution,
      uTime,
      uIsHovered,
      uMouseUV,
      uPrevMouse,
      uMove,
      uniforms: this.userUniforms,
      uv: uv(),
    };

    this.material = new THREE.MeshBasicNodeMaterial();
    this.material.transparent = true;
    // 既定はテクスチャをそのまま表示（旧 defaultFragmentShader と同じ挙動）。
    this.material.colorNode = options.colorNode ? options.colorNode(ctx) : uTexture;
    if (options.positionNode) {
      this.material.positionNode = options.positionNode(ctx);
    }
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
    this.nodes.uTime.value = elapsedTime;
    this.updateMouseMotion();
    if (this.positionCalculator) {
      this.setPosition(scrollX, scrollY);
    }
  }

  /** plane の w/h 比。UV の横方向の引き伸ばしを移動量計算で戻すために使う。 */
  private get rectAspect(): number {
    const rect = this.positionCalculator?.rect ?? this.canvasRect;
    return rect.height > 0 ? rect.width / rect.height : 1;
  }

  /**
   * updateEffects() ではなく毎フレーム走る _tickApply() から呼ぶ。
   * updateEffects() は effect が 0 件だと早期 return するため、effect を使わず
   * colorNode だけで uMove / uPrevMouse を読む plane が更新から漏れる。
   */
  private updateMouseMotion(): void {
    this._mouseMotion.update(this.nodes.uMouseUV.value, this.rectAspect);
    this.nodes.uPrevMouse.value.copy(this._mouseMotion.prev);
    this.nodes.uMove.value = this._mouseMotion.move;
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
          this.nodes.uTexture.value = texture;
        },
        undefined,
        (error: unknown) => {
          console.error(`Failed to load texture: ${texturePath}`, error);
        },
      );
    } else if (this.nodes.uTexture.value !== placeholderTexture) {
      // サブクラス等が構築中に uTexture を差し替えた場合はそれを引き継ぐ。
      this.texture = this.nodes.uTexture.value;
      this.ownsTexture = false;
    }
  }

  private updateSize() {
    if (this.positionCalculator) {
      const rect = this.positionCalculator.rect;
      this.mesh.scale.set(rect.width, rect.height, 1);
      this.nodes.uResolution.value.set(rect.width, rect.height);
    } else {
      this.mesh.scale.set(this.canvasRect.width, this.canvasRect.height, 1);
      this.nodes.uResolution.value.set(
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
        effect._setSize(rect.width, rect.height);
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
      this.nodes.uTexture.value = placeholderTexture;
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
    this.nodes.uTexture.value = texture;
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
            this.nodes.uMouseUV.value.set(lx, ly);
          }
        }
      } else {
        this.nodes.uMouseUV.value.copy(globalMouse);
      }
    }

    // uMouseUV(plane geometry の UV = 左下原点)を、PlaneComposer の fullscreen
    // pass の ctx.uv(左上原点)に合わせて Y 反転して渡す。material 側の uniform は
    // geometry UV 系のまま維持する(colorNode は geometry UV と比較するため)。
    const uv = this.nodes.uMouseUV.value;
    this._effectMouseUV.set(uv.x, 1 - uv.y);
    const effects = this.effects;
    for (let i = 0, n = effects.length; i < n; i++) {
      const effect = effects[i];
      if (!effect.enabled) continue;
      effect._setFrameState(time, this._effectMouseUV);
      effect.update(time, this._effectMouseUV);
      // update() の後。サブクラスが update() で更新する uniform を
      // 蓄積の計算に反映させるため。
      effect._renderFeedback();
    }
  }

  public getMouseUV(): THREE.Vector2 {
    return this.nodes.uMouseUV.value;
  }

  public isHovered(): boolean {
    return this._isHovered;
  }

  public setHoverInfo(isHovered: boolean, uv: THREE.Vector2 | null) {
    this._isHovered = isHovered;
    this.nodes.uIsHovered.value = isHovered ? 1 : 0;
    if (uv) {
      this.nodes.uMouseUV.value.copy(uv);
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
    effect._attachRenderer(this.renderer);
    effect._setRenderer?.(this.renderer);
    effect._register(composer);
    const rect = this.positionCalculator?.rect ?? this.canvasRect;
    effect._setSize(rect.width, rect.height);
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
    // colorNode のノードグラフは構築時に確定しているため、後から参照を注入できない。
    // 出力先の texture() ノードは createPlane の options.uniforms で事前に宣言してもらう。
    const target = this.userUniforms[options.outputUniform] as
      | Partial<TextureNode>
      | undefined;
    if (!target || target.isTextureNode !== true) {
      throw new Error(
        `[DomPlane] addFeedback の outputUniform "${options.outputUniform}" に対応する ` +
          `texture() ノードが options.uniforms にありません。colorNode から参照するため、` +
          `createPlane の options.uniforms に同名の texture() ノードを渡してください。`,
      );
    }
    const buffer = new FeedbackBuffer(this.renderer, options);
    (target as TextureNode).value = buffer.texture;
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
    const target = this.userUniforms[outputUniform];
    if (target && (target as Partial<TextureNode>).isTextureNode === true) {
      // dispose 済みテクスチャを参照し続けないようプレースホルダへ戻す。
      (target as TextureNode).value = placeholderTexture;
    }
    buffer.dispose();
    return true;
  }

  public _tickFeedback(elapsedTime: number): void {
    if (!this.isVisible || this.feedbacks.length === 0) return;
    const aspect = this.rectAspect;
    const hover = this._isHovered ? 1 : 0;
    this._feedbackMouseUV.copy(this.nodes.uMouseUV.value);
    for (let i = 0, n = this.feedbacks.length; i < n; i++) {
      const f = this.feedbacks[i];
      const tex = f.buffer.step({
        mouse: this._feedbackMouseUV,
        hover,
        time: elapsedTime,
        aspect,
      });
      (this.userUniforms[f.outputUniform] as TextureNode).value = tex;
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
    const setupGUI = this.setupGUIHook;
    if (!gui || !setupGUI) return;
    // 二重呼び出しでフォルダが二重に生えないよう、実行後にフックを手放す。
    this.setupGUIHook = undefined;
    // destroy() 後は破棄する側が居ないので、そもそもフォルダを作らせない
    // （BaseEffect._attachGUI() が dispose 済みフォルダを即 destroy するのと同じ意図）。
    if (this.destroyed) return;
    const folder = setupGUI(gui, this);
    if (folder) this._guiFolder = folder;
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

    this._guiFolder?.destroy();
    this._guiFolder = null;
    this.setupGUIHook = undefined;

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
