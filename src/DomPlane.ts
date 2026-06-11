import * as THREE from "three";
import type GUI from "lil-gui";
import type { CreatePlaneOptions } from "./types";
import { DomPositionCalculator } from "./DomPositionCalculator";
import { PlaneComposer } from "./PlaneComposer";
import type { BaseEffect } from "./effects/BaseEffect";

// 全インスタンスで共有する TextureLoader（同一の CrossOrigin 設定）
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
  /**
   * effect.update に渡す mouse UV のスクラッチ。
   * `material.uniforms.uMouseUV.value` を直接渡すと effect 側で `.set()` 等の破壊的操作で
   * plane の uniform が書き換わる事故が起きうるため、毎フレ copy したスクラッチを渡す。
   */
  private readonly _effectMouseUV: THREE.Vector2 = new THREE.Vector2();
  /**
   * effect の `setupGUI` 呼び出し時に root GUI を渡すための provider。
   * WebGLApp.createPlane() でセットされる。null の時は GUI を作らない（showGUI: false 等）。
   *
   * lil-gui は optional peer の dynamic import なので Promise を返す。
   * @internal
   */
  private guiProvider: (() => Promise<GUI>) | null = null;
  /** 自前で load した texture かどうか。destroy() で dispose してよいか判定する。 */
  private ownsTexture: boolean = false;
  /**
   * options.crossOrigin を指定された場合のみ生成する per-instance loader。
   * 指定なしの場合は sharedTextureLoader をそのまま使う。
   */
  private crossOrigin: string | undefined;

  constructor(
    el: HTMLElement | null,
    scene: THREE.Scene,
    canvasRect: DOMRect,
    renderer: THREE.WebGLRenderer,
    options: CreatePlaneOptions = {},
    sharedClock?: THREE.Clock,
  ) {
    this.element = el;
    this.scene = scene;
    this.renderer = renderer;
    this.texture = null;
    this.destroyed = false;
    this.updateRectEveryFrame = options.updateRectEveryFrame || false;
    this.crossOrigin = options.crossOrigin;
    this.clock = sharedClock ?? new THREE.Clock();
    this.canvasRect = canvasRect;
    this.positionCalculator = el
      ? new DomPositionCalculator(el, canvasRect)
      : null;

    // フルスクリーンは常に表示、DOM要素は IntersectionObserver で監視
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

    // デフォルトのuniformsとカスタムuniformsをマージ
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
    // IntersectionObserver の初回 callback が来るまで（最低 1 frame）に
    // mesh が一瞬表示される問題を避けるため、初期 visibility を反映しておく。
    this.mesh.visible = this.isVisible;

    // シーンに自動追加
    this.scene.add(this.mesh);

    this.init();
    // 毎フレームの uTime / 位置追従 / planeComposer.render は Core.animate から
    // _tickRead → _tickApply → _tickRenderComposer の順に直接呼ばれる。
    // これによりレイアウト read（getBoundingClientRect）と write（mesh.position 等）が
    // フェーズ分離され、複数 plane 間での強制リフローを避けられる。
  }

  /**
   * Phase B-read (DOM read): getBoundingClientRect 等のレイアウト読み取りのみを行う。
   * Core.animate では paint 直前にまとめて呼ばれ、その直後に _tickApply が走る。
   *
   * **更新条件**: `updateRectEveryFrame: true` のときのみ毎フレ更新する。
   * static 要素は document 座標で固定 / fixed 要素は viewport 座標で固定なので、
   * 自身の CSS animation 等で動的に位置が変わるケースのみフラグを true に。
   * (旧仕様では isFixed のとき自動的に毎フレ更新していたが、多くの場合不要な
   *  layout 強制になっていたため明示フラグ駆動に変更)
   * @internal Core.animate から呼ばれる。
   */
  public _tickRead(scrollX: number, scrollY: number): void {
    if (!this.isVisible || !this.positionCalculator) return;
    if (this.updateRectEveryFrame) {
      this.positionCalculator.updatePositionInfo(scrollX, scrollY);
    }
  }

  /**
   * Phase B-apply: mesh.position と uniforms の書き込み。DOM には触れない。
   * @internal Core.animate から呼ばれる。
   */
  public _tickApply(elapsedTime: number, scrollX: number, scrollY: number): void {
    if (!this.isVisible) return;
    this.material.uniforms.uTime.value = elapsedTime;
    if (this.positionCalculator) {
      this.setPosition(scrollX, scrollY);
    }
  }

  /**
   * Phase C (PlaneComposer render): main scene レンダリング前に
   * 自前の plane をローカル FBO に焼いてエフェクトを通す。
   * @internal Core.animate から呼ばれる。
   */
  public _tickRenderComposer(): void {
    if (!this.isVisible) return;
    this.planeComposer?.render();
  }

  private init() {
    this.loadTexture();
    this.resize();
  }

  private loadTexture() {
    const texturePath = this.element?.getAttribute("data-texture");

    if (texturePath) {
      // options.crossOrigin が指定されていれば per-instance loader を作る。
      // shared loader を毎回書き換えると並行 load の他 plane に副作用が出るため。
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
            // 既に破棄済みなら自前で dispose して GPU リソースを返す
            texture.dispose();
            return;
          }
          this.texture = texture;
          this.ownsTexture = true; // 自前 load なので所有
          this.material.uniforms.uTexture.value = texture;
        },
        undefined,
        (error: unknown) => {
          console.error(`Failed to load texture: ${texturePath}`, error);
        },
      );
    } else if (this.material.uniforms.uTexture.value) {
      // 外部由来（例：Dom3DObject や uniforms 渡し）。所有しない。
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
      // フルスクリーン: canvasサイズに合わせる
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
  }

  public setCanvasRect(canvasRect: DOMRect) {
    this.canvasRect = canvasRect;
    if (this.positionCalculator) {
      this.positionCalculator.setCanvasRect(canvasRect);
    }
  }

  public resize() {
    if (this.positionCalculator) {
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;

      this.positionCalculator.refreshPositionType();
      this.positionCalculator.updatePositionInfo(scrollX, scrollY);

      this.updateSize();
      this.setPosition(scrollX, scrollY);
    } else {
      this.updateSize();
      this.mesh.position.set(0, 0, 0);
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

  /**
   * テクスチャを差し替える。
   * 直接 `material.uniforms.uTexture.value = tex` する代わりに使うと、
   * 旧テクスチャの所有権（自前 load かどうか）を考慮して安全に dispose してくれる。
   *
   * @param texture 新しい texture
   * @param takeOwnership true なら destroy() 時にこの texture も dispose する。
   *                      他で使い回す texture を渡すときは false。
   */
  /**
   * 現在の `data-texture` 属性を再読込してマテリアルに反映する。
   * SPA で plane を貼ったまま画像 URL だけ差し替えたいケース用。
   * 旧 texture が自前 load の場合は dispose する。属性が無ければ何もしない。
   */
  public reloadTexture(): void {
    // 既存自前 texture を dispose してから loadTexture を呼ぶ。
    if (this.texture && this.ownsTexture) {
      this.texture.dispose();
      this.texture = null;
      this.material.uniforms.uTexture.value = null;
      this.ownsTexture = false;
    }
    this.loadTexture();
  }

  public setTexture(texture: THREE.Texture, takeOwnership: boolean = false): void {
    // 自前で持っていた旧 texture のみ dispose（外部由来は触らない）
    if (this.texture && this.ownsTexture && this.texture !== texture) {
      this.texture.dispose();
    }
    this.texture = texture;
    this.ownsTexture = takeOwnership;
    this.material.uniforms.uTexture.value = texture;
  }

  /**
   * 紐づけられたエフェクトに update を流す。Core.animate から呼ばれる。
   *
   * 引数 `globalMouse` は canvas 全体の UV（0〜1, Y-up）。これを **plane ローカルの UV** に変換して
   * effect.update に渡す。これで FluidEffect 等が plane の中の座標として mouse を扱える。
   *
   * - フルスクリーン plane（element 無し）: そのまま globalMouse を渡す
   * - DOM 配置 plane: 自分の DOM rect と canvasRect から local UV を算出
   * - マウスが plane の外にいる時は **last value を据え置き**（uv 更新せず）。
   *   これにより solver 側で delta が 0 になり force が立たない、自然な挙動になる。
   *
   * 注意: raycast には依存しない。PlaneComposer が sourceMesh を main scene から外すと
   * raycast が思った通り当たらないケースがあるため。
   *
   * scrollX/Y は Core.animate が 1 rAF tick 上で 1 回確定したスナップショット値を渡す。
   * ここで `window.scrollX/Y` を直接読むと
   *（同一 frame で全コンポーネントが同じ scroll 値を共有する）を壊すため必ず引数経由。
   * 後方互換のため省略可能だが、その場合は window から読む (= 古い挙動)。
   */
  public updateEffects(
    time: number,
    globalMouse?: THREE.Vector2,
    scrollX: number = window.scrollX,
    scrollY: number = window.scrollY,
  ) {
    if (this.effects.length === 0) return;

    if (globalMouse) {
      if (this.positionCalculator) {
        const pc = this.positionCalculator;
        const cr = this.canvasRect;
        const rectW = pc.rect.width;
        const rectH = pc.rect.height;
        if (cr.width > 0 && cr.height > 0 && rectW > 0 && rectH > 0) {
          // 旧実装は `positionCalculator.rect.left/top` (viewport 座標) を直接使って
          // いたが、scroll 中は static 要素の viewport top/left が動くため `_tickRead`
          // で毎フレ rect を更新する必要があった。今は `updateRectEveryFrame` フラグ
          // 駆動にしたので rect は scroll で古くなる。
          //
          // 代わりに `pageTop` / `pageLeft` (document 座標、scroll 不変) と
          // 引数の scrollX/Y (Core.animate の 1 frame snapshot) から viewport 上の
          // top/left を再構成する。`getBoundingClientRect` を呼ばないので layout 強制なし。
          // (isFixed 要素は pageTop が viewport 座標で固定なので scroll を引かない)
          const viewportLeft = pc.isFixed ? pc.pageLeft : pc.pageLeft - scrollX;
          const viewportTop = pc.isFixed ? pc.pageTop : pc.pageTop - scrollY;

          // plane の bbox を canvas UV 空間（Y-up）で求める
          const planeLeft = (viewportLeft - cr.left) / cr.width;
          const planeTop = (viewportTop - cr.top) / cr.height;
          const planeW = rectW / cr.width;
          const planeH = rectH / cr.height;
          const planeBottomYup = 1 - planeTop - planeH;
          const lx = (globalMouse.x - planeLeft) / planeW;
          const ly = (globalMouse.y - planeBottomYup) / planeH;

          // [0,1] の中にいる時だけ更新。外なら据え置き → delta=0 で force 立たず。
          if (lx >= 0 && lx <= 1 && ly >= 0 && ly <= 1) {
            this.material.uniforms.uMouseUV.value.set(lx, ly);
          }
        }
      } else {
        // フルスクリーン: local UV == global UV
        this.material.uniforms.uMouseUV.value.copy(globalMouse);
      }
    }

    // uniform の Vector2 をそのまま effect.update に渡すと、effect 側で破壊的操作されると
    // plane の uMouseUV が壊れる。スクラッチに copy して渡すことで isolation を確保する。
    const uniformUV = this.material.uniforms.uMouseUV.value as THREE.Vector2;
    this._effectMouseUV.copy(uniformUV);
    const effects = this.effects;
    for (let i = 0, n = effects.length; i < n; i++) {
      const effect = effects[i];
      if (!effect.enabled) continue;
      effect.update(time, this._effectMouseUV);
    }
  }

  /** 直近の plane ローカル UV を取得（updateEffects 内で算出された値、0〜1）。 */
  public getMouseUV(): THREE.Vector2 {
    return this.material.uniforms.uMouseUV.value as THREE.Vector2;
  }

  /** マウスが現在 plane の上に乗っているかどうか。 */
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
    // renderer を要求するエフェクト（FluidEffect 等）に注入してから register する
    effect._setRenderer?.(this.renderer);
    effect._register(composer);
    const rect = this.positionCalculator?.rect ?? this.canvasRect;
    effect.resize?.(rect.width, rect.height);
    // setupGUI を実装している場合は自動で lil-gui パネルを生やす。
    // lil-gui は optional peer の dynamic import なので provider が Promise を返す。
    if (this.guiProvider && effect.setupGUI) {
      this.guiProvider()
        .then((gui) => {
          if (this.destroyed) return;
          effect.setupGUI!(gui);
        })
        .catch((err) => {
          console.warn(
            '[DomPlane] effect.setupGUI に渡す lil-gui の読み込みに失敗しました。' +
            'npm install lil-gui してください。',
            err,
          );
        });
    }
    this.effects.push(effect);
    return effect;
  }

  /**
   * `addEffect()` で登録した effect を取り除き、pass material を dispose する。
   * 登録されていない effect を渡した時は何もしない（戻り値 false）。
   */
  public removeEffect(effect: BaseEffect): boolean {
    const idx = this.effects.indexOf(effect);
    if (idx < 0) return false;
    this.effects.splice(idx, 1);
    const pass = effect.getPass();
    if (pass && this.planeComposer) {
      this.planeComposer.removeEffect(pass);
    }
    effect.dispose?.();
    return true;
  }

  /**
   * WebGLApp.createPlane() から呼ばれる。GUI lazy 取得関数を渡す。
   * null を渡すと GUI 統合を無効化（showGUI: false 相当）。
   * @internal
   */
  public _setGuiProvider(provider: (() => Promise<GUI>) | null): void {
    this.guiProvider = provider;
  }

  public destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.observer?.disconnect();

    for (const effect of this.effects) {
      effect.dispose?.();
    }
    this.effects = [];

    if (this.planeComposer) {
      this.planeComposer.dispose(); // mesh を scene に戻してから
      this.planeComposer = null;
    }
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    // 自前で load した texture のみ dispose。
    // 外部から渡された texture を dispose すると他の plane が壊れる。
    if (this.texture && this.ownsTexture) {
      this.texture.dispose();
    }
    this.texture = null;
  }
}
