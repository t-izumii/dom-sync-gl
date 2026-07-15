import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import type GUI from 'lil-gui';
import { BaseEffect, type BaseEffectConfig } from '../effects/BaseEffect';

// WebGLRenderer は WebGL コンテキストを要求し jsdom では失敗するためスタブ化（Core.test と同方針）。
// PlaneComposer / FeedbackBuffer が使う renderer メソッドも含める。
vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  class MockWebGLRenderer {
    domElement: HTMLCanvasElement;
    outputColorSpace = '';
    private dpr = 1;
    constructor(opts: { canvas?: HTMLCanvasElement }) {
      this.domElement = opts.canvas ?? document.createElement('canvas');
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
    WebGLRenderer: MockWebGLRenderer,
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

class TestEffect extends BaseEffect {
  protected getConfig(): BaseEffectConfig {
    return { fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }' };
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
    // post effect を追加すると PlaneComposer が mesh を mainScene から外す（parent === null）。
    // 以後レンダーループでの matrixWorld 自動更新が走らなくなり、PointerController のレイキャストが
    // 単位行列前提のズレた座標で判定して恒久的に hover しなくなるバグの回帰テスト。
    it('addEffect 後も setPosition で mesh.matrixWorld が実際の position を反映する', async () => {
      const app = new DomSyncGL(container);
      const el = document.createElement('div');
      document.body.appendChild(el);
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(100, 50, 200, 100)
      );

      const plane = app.createPlane(el) as DomPlane;
      await flush(); // isVisible=true にする（IntersectionObserver）

      // post effect を追加 → PlaneComposer が mesh を scene から外す
      plane.addEffect(new TestEffect());
      expect(plane.getMesh().parent).toBeNull();

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
});
