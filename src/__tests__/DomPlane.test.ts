import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three/webgpu';
import { texture, uniform } from 'three/tsl';
import type GUI from 'lil-gui';
import { BaseEffect, type BaseEffectConfig } from '../effects/BaseEffect';
import type { PlaneNodeContext } from '../types';

// WebGPURenderer は GPU device を要求し jsdom では失敗するためスタブ化（Core.test と同方針）。
// PlaneComposer / FeedbackBuffer が使う renderer メソッドも含める。
vi.mock('three/webgpu', async () => {
  const actual =
    await vi.importActual<typeof import('three/webgpu')>('three/webgpu');
  class MockWebGPURenderer {
    domElement: HTMLCanvasElement;
    outputColorSpace = '';
    private dpr = 1;
    constructor(opts: { canvas?: HTMLCanvasElement }) {
      this.domElement = opts.canvas ?? document.createElement('canvas');
    }
    init(): Promise<void> {
      return Promise.resolve();
    }
    setSize() {}
    setPixelRatio(v: number) {
      this.dpr = v;
    }
    getPixelRatio() {
      return this.dpr;
    }
    setRenderTarget() {}
    getRenderTarget() {
      return null;
    }
    getClearColor(c: { set: (v: unknown) => void }) {
      return c;
    }
    getClearAlpha() {
      return 1;
    }
    setClearColor() {}
    clear() {}
    render() {}
    dispose() {}
  }
  return {
    ...actual,
    WebGPURenderer: MockWebGPURenderer,
  };
});

vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: class {
    update() {}
    dispose() {}
  },
}));

import { DomSyncGL } from '../Core';
import type { DomPlane } from '../DomPlane';
import type { PlaneComposer } from '../PlaneComposer';
import { EffectManager } from '../EffectManager';

class TestEffect extends BaseEffect {
  protected getConfig(): BaseEffectConfig {
    // 前段の出力をそのまま返す素通しエフェクト（旧 passthrough fragmentShader 相当）
    return { outputNode: (ctx) => ctx.inputTexture };
  }
}

function makeGUI(): GUI {
  return { destroy: vi.fn() } as unknown as GUI;
}

// マイクロタスクキューを flush する。IntersectionObserver のコールバックは実ブラウザでは
// 非同期発火するため、スタブ側も queueMicrotask で揃えている（constructor 内で mesh 生成前に
// 同期発火すると壊れるため）。
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('DomPlane', () => {
  let container: HTMLElement;
  let disconnectSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 800, 600)
    );

    disconnectSpy = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        private callback: IntersectionObserverCallback;
        constructor(callback: IntersectionObserverCallback) {
          this.callback = callback;
        }
        // 要素ロック plane は isVisible=false で始まり、observer の isIntersecting
        // で初めて true になる。実ブラウザ同様マイクロタスクで非同期発火する
        // （DomPlane コンストラクタは observer.observe() の後で this.mesh を作るため、
        // 同期発火させるとコンストラクタ完了前に this.mesh へアクセスして壊れる）。
        observe(target: Element) {
          queueMicrotask(() => {
            this.callback(
              [{ isIntersecting: true, target } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver
            );
          });
        }
        unobserve() {}
        disconnect = disconnectSpy;
      }
    );

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('gui 配線（DI 化の回帰）', () => {
    it('gui を渡さない場合、addEffect の setupGUI は呼ばれない', () => {
      const app = new DomSyncGL(container);
      const plane = app.createPlane(null) as DomPlane;
      const effect = new TestEffect();
      effect.setupGUI = vi.fn();

      plane.addEffect(effect);

      expect(effect.setupGUI).not.toHaveBeenCalled();
      app.destroy();
    });

    it('gui を渡すと addEffect の setupGUI(gui) が呼ばれ、戻り値フォルダが _attachGUI される', () => {
      const gui = makeGUI();
      const app = new DomSyncGL(container, { gui });
      const plane = app.createPlane(null) as DomPlane;
      const effect = new TestEffect();
      const folder = makeGUI();
      effect.setupGUI = vi.fn(() => folder);
      const attachSpy = vi.spyOn(effect, '_attachGUI');

      plane.addEffect(effect);

      expect(effect.setupGUI).toHaveBeenCalledWith(gui);
      expect(attachSpy).toHaveBeenCalledWith(folder);
      app.destroy();
    });

    it('removeEffect() は setupGUI が返したフォルダを破棄する（戻り値破棄漏れの回帰）', () => {
      const gui = makeGUI();
      const app = new DomSyncGL(container, { gui });
      const plane = app.createPlane(null) as DomPlane;
      const effect = new TestEffect();
      const folder = makeGUI();
      effect.setupGUI = vi.fn(() => folder);

      plane.addEffect(effect);
      const removed = plane.removeEffect(effect);

      expect(removed).toBe(true);
      expect(folder.destroy).toHaveBeenCalledTimes(1);
      app.destroy();
    });

    it('destroy() は登録済み effect が持つ GUI フォルダも破棄する', () => {
      const gui = makeGUI();
      const app = new DomSyncGL(container, { gui });
      const plane = app.createPlane(null) as DomPlane;
      const effect = new TestEffect();
      const folder = makeGUI();
      effect.setupGUI = vi.fn(() => folder);

      plane.addEffect(effect);
      app.destroy();

      expect(folder.destroy).toHaveBeenCalledTimes(1);
    });

    it('removeEffect: 未登録の effect には false を返す', () => {
      const app = new DomSyncGL(container);
      const plane = app.createPlane(null) as DomPlane;
      const stranger = new TestEffect();
      expect(plane.removeEffect(stranger)).toBe(false);
      app.destroy();
    });
  });

  describe('destroy() のリソース解放', () => {
    it('geometry / material / observer が解放される', async () => {
      const app = new DomSyncGL(container);
      const el = document.createElement('div');
      document.body.appendChild(el);
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, 100, 100)
      );
      const plane = app.createPlane(el) as DomPlane;
      await flush();
      const geoDisposeSpy = vi.spyOn(plane.geometry, 'dispose');
      const matDisposeSpy = vi.spyOn(plane.material, 'dispose');

      app.removePlane(plane);

      expect(geoDisposeSpy).toHaveBeenCalledTimes(1);
      expect(matDisposeSpy).toHaveBeenCalledTimes(1);
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
      app.destroy();
    });

    it('setTexture(texture, true) で所有権を持つと destroy() 時に texture.dispose() される', () => {
      const app = new DomSyncGL(container);
      const plane = app.createPlane(null) as DomPlane;
      const texture = new THREE.Texture();
      const disposeSpy = vi.spyOn(texture, 'dispose');

      plane.setTexture(texture, true);
      app.removePlane(plane);

      expect(disposeSpy).toHaveBeenCalledTimes(1);
      app.destroy();
    });

    it('setTexture(texture, false) は所有権を持たず、destroy() 時に texture.dispose() されない', () => {
      const app = new DomSyncGL(container);
      const plane = app.createPlane(null) as DomPlane;
      const texture = new THREE.Texture();
      const disposeSpy = vi.spyOn(texture, 'dispose');

      plane.setTexture(texture, false);
      app.removePlane(plane);

      expect(disposeSpy).not.toHaveBeenCalled();
      app.destroy();
    });

    it('setTexture で前の所有テクスチャを差し替えると、古い方だけ dispose される', () => {
      const app = new DomSyncGL(container);
      const plane = app.createPlane(null) as DomPlane;
      const tex1 = new THREE.Texture();
      const tex2 = new THREE.Texture();
      const dispose1 = vi.spyOn(tex1, 'dispose');
      const dispose2 = vi.spyOn(tex2, 'dispose');

      plane.setTexture(tex1, true);
      plane.setTexture(tex2, true);

      expect(dispose1).toHaveBeenCalledTimes(1);
      expect(dispose2).not.toHaveBeenCalled();
      app.destroy();
    });
  });

  describe('matrixWorld 更新（post effect 後の hover 判定の回帰）', () => {
    // 新方式では post effect を足しても mesh は scene に残る（material 差し替えのみ）。
    // PointerController のレイキャストはフレーム内でレンダーより前に走るため、
    // setPosition で明示的に matrixWorld を更新して常に最新座標で hover 判定できることの回帰テスト。
    it('addEffect 後も mesh は scene 所属のまま、setPosition で matrixWorld が実際の position を反映する', async () => {
      const app = new DomSyncGL(container);
      const el = document.createElement('div');
      document.body.appendChild(el);
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(100, 50, 200, 100)
      );

      const plane = app.createPlane(el) as DomPlane;
      await flush(); // isVisible=true にする（IntersectionObserver）

      // post effect を追加しても mesh は scene に残る（material だけ差し替わる）
      plane.addEffect(new TestEffect());
      expect(plane.getMesh().parent).toBe(app.getScene());

      // フレーム更新（実アプリの _tickApply 相当）で位置を反映させる
      plane._tickApply(0, 0, 0);

      const mesh = plane.getMesh();
      // ローカル position は正しく設定されている
      // canvas 800x600 中心(400,300)、el(left100,top50,w200,h100) → (-200, 200, 0)
      expect(mesh.position.x).toBeCloseTo(-200);
      expect(mesh.position.y).toBeCloseTo(200);

      // matrixWorld がローカル position を反映していること（単位行列のままでないこと）
      const worldPos = new THREE.Vector3().setFromMatrixPosition(
        mesh.matrixWorld
      );
      expect(worldPos.x).toBeCloseTo(mesh.position.x);
      expect(worldPos.y).toBeCloseTo(mesh.position.y);
      expect(worldPos.z).toBeCloseTo(mesh.position.z);

      // 念のため単位行列でないことを明示的に確認
      expect(mesh.matrixWorld.equals(new THREE.Matrix4())).toBe(false);

      app.destroy();
    });

    it('post effect 無しでも setPosition で matrixWorld が更新される（既存動作への非悪影響）', async () => {
      const app = new DomSyncGL(container);
      const el = document.createElement('div');
      document.body.appendChild(el);
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(100, 50, 200, 100)
      );

      const plane = app.createPlane(el) as DomPlane;
      await flush();

      plane._tickApply(0, 0, 0);

      const mesh = plane.getMesh();
      const worldPos = new THREE.Vector3().setFromMatrixPosition(
        mesh.matrixWorld
      );
      expect(worldPos.x).toBeCloseTo(mesh.position.x);
      expect(worldPos.y).toBeCloseTo(mesh.position.y);

      app.destroy();
    });
  });

  describe('position: sticky（毎フレーム再計測の回帰）', () => {
    it('sticky 要素は updateRectEveryFrame: false でも毎フレーム rect を読み直す', async () => {
      const app = new DomSyncGL(container);
      const el = document.createElement('div');
      document.body.appendChild(el);
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, 100, 100)
      );
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        position: 'sticky',
      } as CSSStyleDeclaration);

      // updateRectEveryFrame を明示的に指定しない（既定 false）
      const plane = app.createPlane(el) as DomPlane;
      await flush();
      const updateSpy = vi.spyOn(plane.positionCalculator!, 'updatePositionInfo');

      plane._tickRead(0, 0);
      plane._tickRead(0, 10);

      expect(updateSpy).toHaveBeenCalledTimes(2);
      app.destroy();
    });

    it('非 sticky 要素は updateRectEveryFrame: false だと毎フレームは再計測しない', async () => {
      const app = new DomSyncGL(container);
      const el = document.createElement('div');
      document.body.appendChild(el);
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, 100, 100)
      );
      // getComputedStyle の既定 position は 'static'（jsdom 既定）

      const plane = app.createPlane(el) as DomPlane;
      await flush();
      const updateSpy = vi.spyOn(plane.positionCalculator!, 'updatePositionInfo');

      plane._tickRead(0, 0);
      plane._tickRead(0, 10);

      expect(updateSpy).not.toHaveBeenCalled();
      app.destroy();
    });
  });

  describe('PlaneNodeContext のマウス移動情報', () => {
    // colorNode / positionNode 側にも「前フレーム位置」と「移動強度」を配る。
    const capture = (
      app: DomSyncGL,
    ): { plane: DomPlane; ctx: PlaneNodeContext } => {
      let ctx: PlaneNodeContext | null = null;
      const plane = app.createPlane(null, {
        colorNode: (c) => {
          ctx = c;
          return c.uTexture;
        },
      }) as DomPlane;
      return { plane, ctx: ctx! };
    };

    it('uPrevMouse は前フレームの uMouseUV を指す（初回は現在位置と同値）', () => {
      const app = new DomSyncGL(container);
      const { plane, ctx } = capture(app);

      plane.setHoverInfo(true, new THREE.Vector2(0.2, 0.3));
      plane._tickApply(0, 0, 0);
      expect((ctx.uPrevMouse.value as THREE.Vector2).x).toBeCloseTo(0.2);
      expect((ctx.uPrevMouse.value as THREE.Vector2).y).toBeCloseTo(0.3);

      plane.setHoverInfo(true, new THREE.Vector2(0.8, 0.9));
      plane._tickApply(1, 0, 0);

      expect((ctx.uPrevMouse.value as THREE.Vector2).x).toBeCloseTo(0.2);
      expect((ctx.uPrevMouse.value as THREE.Vector2).y).toBeCloseTo(0.3);
      // uMouseUV は plane geometry の UV（左下原点）のまま。uPrevMouse も同じ座標系。
      expect((ctx.uMouseUV.value as THREE.Vector2).x).toBeCloseTo(0.8);
      app.destroy();
    });

    it('uMove は移動で立ち上がり、静止すると減衰する', () => {
      const app = new DomSyncGL(container);
      const { plane, ctx } = capture(app);

      plane.setHoverInfo(true, new THREE.Vector2(0.5, 0.5));
      plane._tickApply(0, 0, 0);
      expect(ctx.uMove.value).toBe(0);

      // canvas 800x600 → aspect 4/3。dx=0.003 * 4/3 = 0.004 → scale 0.01 で 0.4
      plane.setHoverInfo(true, new THREE.Vector2(0.503, 0.5));
      plane._tickApply(1, 0, 0);
      const peak = ctx.uMove.value as number;
      expect(peak).toBeCloseTo(0.4);

      plane._tickApply(2, 0, 0);

      expect(ctx.uMove.value).toBeCloseTo(peak * 0.85);
      app.destroy();
    });

    it('effect が 0 件でも毎フレーム更新される（updateEffects の早期 return に依存しない）', () => {
      const app = new DomSyncGL(container);
      const { plane, ctx } = capture(app);

      plane.setHoverInfo(true, new THREE.Vector2(0.5, 0.5));
      plane.updateEffects(0, new THREE.Vector2(0.5, 0.5), 0, 0);
      plane._tickApply(0, 0, 0);
      plane.setHoverInfo(true, new THREE.Vector2(0.55, 0.5));
      plane.updateEffects(1, new THREE.Vector2(0.55, 0.5), 0, 0);
      plane._tickApply(1, 0, 0);

      expect(ctx.uMove.value).toBe(1);
      expect((ctx.uPrevMouse.value as THREE.Vector2).x).toBeCloseTo(0.5);
      app.destroy();
    });
  });

  describe('予約 uniform の上書き防止（CR-11）', () => {
    it('予約名 uniform を渡すと throw する', () => {
      const app = new DomSyncGL(container);
      expect(() =>
        app.createPlane(null, { uniforms: { uResolution: uniform(0) } }),
      ).toThrow(/uResolution/);
      app.destroy();
    });

    it('uPrevMouse / uMove も予約名として throw する', () => {
      const app = new DomSyncGL(container);
      expect(() =>
        app.createPlane(null, {
          uniforms: { uPrevMouse: uniform(new THREE.Vector2()) },
        }),
      ).toThrow(/uPrevMouse/);
      expect(() =>
        app.createPlane(null, { uniforms: { uMove: uniform(0) } }),
      ).toThrow(/uMove/);
      app.destroy();
    });

    it('予約名以外のカスタム uniform は colorNode の ctx.uniforms から参照できる', () => {
      const app = new DomSyncGL(container);
      const uCustom = uniform(1.23);
      let captured: PlaneNodeContext | null = null;
      app.createPlane(null, {
        uniforms: { uCustom },
        colorNode: (ctx) => {
          captured = ctx;
          return ctx.uTexture;
        },
      });
      expect(captured!.uniforms.uCustom).toBe(uCustom);
      expect(captured!.uniforms.uCustom.value).toBe(1.23);
      app.destroy();
    });

    it('addFeedback の outputUniform が予約名だと throw する', () => {
      const app = new DomSyncGL(container);
      const plane = app.createPlane(null) as DomPlane;
      expect(() =>
        plane.addFeedback({
          outputNode: (ctx) => ctx.uPrev,
          outputUniform: 'uTexture',
        }),
      ).toThrow(/uTexture/);
      app.destroy();
    });

    it('addFeedback: outputUniform と同名の texture() ノードを事前宣言していないと throw する', () => {
      // colorNode のノードグラフは構築時に確定するため、後から参照を注入できない
      // （新契約: createPlane の options.uniforms で texture() ノードを事前宣言する）。
      const app = new DomSyncGL(container);
      const plane = app.createPlane(null) as DomPlane;
      expect(() =>
        plane.addFeedback({
          outputNode: (ctx) => ctx.uPrev,
          outputUniform: 'uFeedback',
        }),
      ).toThrow(/texture\(\) ノードが options\.uniforms にありません/);
      app.destroy();
    });

    it('addFeedback: 事前宣言した texture() ノードへ出力テクスチャが供給される', () => {
      const app = new DomSyncGL(container);
      const uFeedback = texture(new THREE.Texture());
      const plane = app.createPlane(null, {
        uniforms: { uFeedback },
      }) as DomPlane;
      const buffer = plane.addFeedback({
        outputNode: (ctx) => ctx.uPrev,
        outputUniform: 'uFeedback',
      });
      expect(uFeedback.value).toBe(buffer.texture);
      app.destroy();
    });
  });

  describe('effect の単一 owner・使い捨て契約（CR-07）', () => {
    it('同じ effect を同じ plane に 2 回 addEffect すると throw する', () => {
      const app = new DomSyncGL(container);
      const plane = app.createPlane(null) as DomPlane;
      const effect = new TestEffect();

      plane.addEffect(effect);

      expect(() => plane.addEffect(effect)).toThrow(/既に別の owner に登録済み/);
      app.destroy();
    });

    it('plane に add した effect を EffectManager に add するとまたがった二重登録で throw する', () => {
      const app = new DomSyncGL(container);
      const plane = app.createPlane(null) as DomPlane;
      const manager = new EffectManager({ renderer: app.getRenderer(), gui: null });
      const effect = new TestEffect();

      plane.addEffect(effect);

      expect(() => manager.addEffect(effect, 100, 100)).toThrow(
        /既に別の owner に登録済み/,
      );
      app.destroy();
    });

    it('removeEffect で dispose 済みの effect は再 addEffect できず throw する', () => {
      const app = new DomSyncGL(container);
      const plane = app.createPlane(null) as DomPlane;
      const effect = new TestEffect();

      plane.addEffect(effect);
      plane.removeEffect(effect);

      expect(() => plane.addEffect(effect)).toThrow(/dispose 済み/);
      app.destroy();
    });
  });

  describe('最後の effect 除去で PlaneComposer を解放する（CR-18）', () => {
    type WithComposer = { planeComposer: PlaneComposer | null };

    it('最後の effect を removeEffect すると composer が dispose され material が元に戻る', () => {
      const app = new DomSyncGL(container);
      const plane = app.createPlane(null) as DomPlane;
      const scene = app.getScene();
      const mesh = plane.getMesh();
      const original = mesh.material;

      const effect = new TestEffect();
      plane.addEffect(effect);
      // 新方式では sourceMesh は scene に残ったまま
      expect(scene.children).toContain(mesh);

      const composer = (plane as unknown as WithComposer).planeComposer!;
      const disposeSpy = vi.spyOn(composer, 'dispose');

      plane.removeEffect(effect);

      expect(disposeSpy).toHaveBeenCalledTimes(1);
      expect((plane as unknown as WithComposer).planeComposer).toBeNull();
      // dispose が material を元へ戻し、mesh は scene に残り続ける
      expect(scene.children).toContain(mesh);
      expect(mesh.material).toBe(original);
      app.destroy();
    });

    it('composer 解放後に再度 addEffect すると新しい composer で動作する', () => {
      const app = new DomSyncGL(container);
      const plane = app.createPlane(null) as DomPlane;
      const scene = app.getScene();
      const mesh = plane.getMesh();

      const effect1 = new TestEffect();
      plane.addEffect(effect1);
      const composer1 = (plane as unknown as WithComposer).planeComposer;
      plane.removeEffect(effect1);
      expect((plane as unknown as WithComposer).planeComposer).toBeNull();

      // dispose 済み effect は再利用できないため新しい effect を add する
      plane.addEffect(new TestEffect());
      const composer2 = (plane as unknown as WithComposer).planeComposer;

      expect(composer2).not.toBeNull();
      expect(composer2).not.toBe(composer1);
      // sourceMesh は一貫して scene に残り続ける
      expect(scene.children).toContain(mesh);
      app.destroy();
    });
  });

  describe('テクスチャ再読込の非同期 race（CR-08）', () => {
    function makeTexEl(): HTMLElement {
      const el = document.createElement('div');
      el.setAttribute('data-texture', '/img/a.png');
      document.body.appendChild(el);
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, 100, 100),
      );
      return el;
    }

    it('ロード完了順が逆転しても後開始が勝ち、遅れて届いた古い texture は dispose される', () => {
      // TextureLoader.load の onLoad を捕捉して手動発火する（既存のモック手法を踏襲）。
      const loadCallbacks: Array<(t: THREE.Texture) => void> = [];
      vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(
        ((_url: string, onLoad: (t: THREE.Texture) => void) => {
          loadCallbacks.push(onLoad);
          return new THREE.Texture();
        }) as never,
      );

      const app = new DomSyncGL(container);
      const el = makeTexEl();
      // 内部の uTexture ノードは非公開のため、colorNode の ctx 経由で捕捉して検証する。
      let captured: PlaneNodeContext | null = null;
      const plane = app.createPlane(el, {
        colorNode: (ctx) => {
          captured = ctx;
          return ctx.uTexture;
        },
      }) as DomPlane; // ロード A 開始

      plane.reloadTexture(); // ロード B 開始
      expect(loadCallbacks.length).toBe(2);

      const texA = new THREE.Texture();
      const texB = new THREE.Texture();
      const disposeA = vi.spyOn(texA, 'dispose');

      loadCallbacks[1](texB); // B が先に完了
      loadCallbacks[0](texA); // A が遅れて完了 → stale

      expect(disposeA).toHaveBeenCalledTimes(1);
      expect(plane.texture).toBe(texB);
      expect(captured!.uTexture.value).toBe(texB);
      app.destroy();
    });

    it('ロード中に setTexture() すると、後から届いた stale なロード結果は破棄される', () => {
      const loadCallbacks: Array<(t: THREE.Texture) => void> = [];
      vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(
        ((_url: string, onLoad: (t: THREE.Texture) => void) => {
          loadCallbacks.push(onLoad);
          return new THREE.Texture();
        }) as never,
      );

      const app = new DomSyncGL(container);
      const el = makeTexEl();
      let captured: PlaneNodeContext | null = null;
      const plane = app.createPlane(el, {
        colorNode: (ctx) => {
          captured = ctx;
          return ctx.uTexture;
        },
      }) as DomPlane; // ロード開始

      const texManual = new THREE.Texture();
      plane.setTexture(texManual, true); // ロード中に手動差し替え

      const texStale = new THREE.Texture();
      const disposeStale = vi.spyOn(texStale, 'dispose');
      loadCallbacks[0](texStale); // 遅れて届いたロード結果

      expect(disposeStale).toHaveBeenCalledTimes(1);
      expect(plane.texture).toBe(texManual);
      expect(captured!.uTexture.value).toBe(texManual);
      app.destroy();
    });
  });

  describe('テクスチャの色空間契約（CR-04）', () => {
    function makeTexEl(): HTMLElement {
      const el = document.createElement('div');
      el.setAttribute('data-texture', '/img/a.png');
      document.body.appendChild(el);
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, 100, 100),
      );
      return el;
    }

    it('data-texture ロードの colorSpace 既定は SRGBColorSpace（NodeMaterial の出力変換と相殺して DOM と一致）', () => {
      // 旧 GLSL 版の既定は NoColorSpace（生値素通し）だったが、NodeMaterial は
      // 画面出力時に linear→sRGB 変換を行うため、入力側も SRGB デコードに揃える。
      const loadCallbacks: Array<(t: THREE.Texture) => void> = [];
      vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(
        ((_url: string, onLoad: (t: THREE.Texture) => void) => {
          loadCallbacks.push(onLoad);
          return new THREE.Texture();
        }) as never,
      );

      const app = new DomSyncGL(container);
      const el = makeTexEl();
      app.createPlane(el);

      const tex = new THREE.Texture();
      loadCallbacks[0](tex);

      expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
      app.destroy();
    });

    it('textureColorSpace オプション指定がロードした texture に反映される（旧挙動の NoColorSpace へ opt-out できる）', () => {
      const loadCallbacks: Array<(t: THREE.Texture) => void> = [];
      vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(
        ((_url: string, onLoad: (t: THREE.Texture) => void) => {
          loadCallbacks.push(onLoad);
          return new THREE.Texture();
        }) as never,
      );

      const app = new DomSyncGL(container);
      const el = makeTexEl();
      app.createPlane(el, { textureColorSpace: THREE.NoColorSpace });

      const tex = new THREE.Texture();
      loadCallbacks[0](tex);

      expect(tex.colorSpace).toBe(THREE.NoColorSpace);
      app.destroy();
    });
  });
});
