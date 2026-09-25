import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// WebGPURenderer は GPU device / WebGL コンテキストを要求するため jsdom では失敗する。
// 機能テストに不要な部分なのでクラス全体を差し替える。
vi.mock('three/webgpu', async () => {
  const actual =
    await vi.importActual<typeof import('three/webgpu')>('three/webgpu');
  class MockWebGPURenderer {
    domElement: HTMLCanvasElement;
    outputColorSpace = '';
    // isWebGPUBackend() の判定対象。init() 後にのみ参照される想定。
    backend = { isWebGPUBackend: true };
    private dpr = 1;
    // render() の保存・復元契約を検証できるよう、バインド中の RT を保持する。
    private currentTarget: unknown = null;
    constructor(opts: { canvas?: HTMLCanvasElement }) {
      this.domElement = opts.canvas ?? document.createElement('canvas');
    }
    // 実物と同じく非同期初期化。Core の ready / render ガードの検証に使う。
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
    setRenderTarget(target: unknown = null) {
      this.currentTarget = target;
    }
    getRenderTarget() {
      return this.currentTarget;
    }
    render() {}
    dispose() {}
  }
  return {
    ...actual,
    WebGPURenderer: MockWebGPURenderer,
  };
});

// OrbitControls は実 DOM API（pointer events）を多数触るのでスタブ化
vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: class {
    update() {}
    dispose() {}
  },
}));

import { DomSyncGL } from '../Core';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type * as THREE from 'three/webgpu';
import type GUI from 'lil-gui';
import { BaseEffect, type BaseEffectConfig } from '../effects/BaseEffect';

class TestEffect extends BaseEffect {
  protected getConfig(): BaseEffectConfig {
    // 前段の出力をそのまま返す素通しエフェクト（旧 passthrough fragmentShader 相当）
    return { outputNode: (ctx) => ctx.inputTexture };
  }
}

describe('DomSyncGL', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 800, 600)
    );
    // rAF が連鎖実行されてテストノイズになるので no-op に
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('コンテナに canvas を追加する', () => {
    const app = new DomSyncGL(container);
    expect(container.contains(app.canvas)).toBe(true);
    app.destroy();
  });

  it('存在しないセレクタを渡すと例外を投げる', () => {
    expect(() => new DomSyncGL('#does-not-exist')).toThrow(/Container not found/);
  });

  it('canvas は display:block に設定される（inline のベースライン隙間を避ける）', () => {
    const app = new DomSyncGL(container);
    expect(app.canvas.style.display).toBe('block');
    app.destroy();
  });

  it('container の計測中は canvas を display:none にして自身の寄与を排除する（フィードバックループ回避）', () => {
    // Given: auto サイズ container を模し、計測時に canvas が display:none なら本来の
    // サイズ（400×300）、そうでなければ canvas ぶん膨らんだサイズ（400×450）を返す。
    const bcrSpy = vi.spyOn(container, 'getBoundingClientRect');
    let canvasHiddenAtMeasure = false;
    bcrSpy.mockImplementation(() => {
      const canvas = container.querySelector('canvas');
      const hidden = !canvas || canvas.style.display === 'none';
      if (hidden) canvasHiddenAtMeasure = true;
      return new DOMRect(0, 0, 400, hidden ? 300 : 450);
    });

    const app = new DomSyncGL(container);

    // Then: 計測は canvas を隠した状態で行われ、canvas 膨張ぶんが rect に混入しない。
    expect(canvasHiddenAtMeasure).toBe(true);
    expect(app.rect.height).toBe(300);
    // 計測後は canvas の display が block に戻っている。
    expect(app.canvas.style.display).toBe('block');

    app.destroy();
  });

  it('addUpdateCallback は callback を登録し、戻り値で解除できる', () => {
    const app = new DomSyncGL(container);
    const cb = vi.fn();
    const unsubscribe = app.addUpdateCallback(cb);

    expect(app.updateCallbacks).toContain(cb);
    unsubscribe();
    expect(app.updateCallbacks).not.toContain(cb);

    app.destroy();
  });

  it('addResizeCallback も同様に登録／解除できる', () => {
    const app = new DomSyncGL(container);
    const cb = vi.fn();
    const unsubscribe = app.addResizeCallback(cb);

    expect(app.resizeCallbacks).toContain(cb);
    unsubscribe();
    expect(app.resizeCallbacks).not.toContain(cb);

    app.destroy();
  });

  it('destroy() で AbortController の signal が aborted=true になる', () => {
    const app = new DomSyncGL(container);
    const signal = (app as unknown as { eventAbort: AbortController }).eventAbort
      .signal;
    expect(signal.aborted).toBe(false);

    app.destroy();
    expect(signal.aborted).toBe(true);
  });

  it('destroy() で rAF がキャンセルされ canvas が DOM から外れる', () => {
    const app = new DomSyncGL(container);
    const canvas = app.canvas;
    expect(container.contains(canvas)).toBe(true);

    app.destroy();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
    expect(container.contains(canvas)).toBe(false);
  });

  it('destroy() で domPlanes / dom3DObjects / callbacks 配列が空になる', () => {
    const app = new DomSyncGL(container);
    app.addUpdateCallback(() => {});
    app.addResizeCallback(() => {});

    app.destroy();
    expect(app.updateCallbacks).toEqual([]);
    expect(app.resizeCallbacks).toEqual([]);
    expect(app.domPlanes).toEqual([]);
    expect(app.dom3DObjects).toEqual([]);
  });

  it('clearEffects はエフェクトが登録されていなくても安全に呼べる', () => {
    const app = new DomSyncGL(container);
    expect(() => app.clearEffects()).not.toThrow();
    app.destroy();
  });

  it('addUpdateCallback の解除関数は重複呼び出しに耐える', () => {
    const app = new DomSyncGL(container);
    const cb = vi.fn();
    const unsubscribe = app.addUpdateCallback(cb);

    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
    expect(app.updateCallbacks).not.toContain(cb);

    app.destroy();
  });

  it('update callback が dispatch 中に自身を解除しても後続が呼ばれ例外にならない', () => {
    const app = new DomSyncGL(container);
    const order: string[] = [];
    let unsubscribeSelf!: () => void;
    unsubscribeSelf = app.addUpdateCallback(() => {
      order.push('a');
      unsubscribeSelf();
    });
    const cbB = vi.fn(() => order.push('b'));
    app.addUpdateCallback(cbB);

    expect(() => app.tick()).not.toThrow();
    expect(order).toEqual(['a', 'b']);
    expect(cbB).toHaveBeenCalledTimes(1);
    // 自身は解除済みなので次フレームでは呼ばれない
    app.tick();
    expect(order).toEqual(['a', 'b', 'b']);

    app.destroy();
  });

  it('update callback が dispatch 中に後続 callback を解除しても例外にならない', () => {
    const app = new DomSyncGL(container);
    let unsubscribeB!: () => void;
    // A を先に登録し、dispatch 中に後続の B を解除する（固定長ループが破綻する条件）
    const cbA = vi.fn(() => unsubscribeB());
    app.addUpdateCallback(cbA);
    const cbB = vi.fn();
    unsubscribeB = app.addUpdateCallback(cbB);

    expect(() => app.tick()).not.toThrow();
    expect(cbA).toHaveBeenCalledTimes(1);
    // snapshot に対して回すため、解除された B もその回はまだ呼ばれうる
    expect(cbB).toHaveBeenCalledTimes(1);
    // 次フレームでは B は解除済みなので呼ばれない
    app.tick();
    expect(cbB).toHaveBeenCalledTimes(1);

    app.destroy();
  });

  it('update callback が dispatch 中に追加した callback はその回では呼ばれず次回から呼ばれる', () => {
    const app = new DomSyncGL(container);
    const added = vi.fn();
    app.addUpdateCallback(() => {
      app.addUpdateCallback(added);
    });

    app.tick();
    // 追加された callback は snapshot 外なので初回は呼ばれない
    expect(added).not.toHaveBeenCalled();

    app.tick();
    // 次フレームからは呼ばれる
    expect(added).toHaveBeenCalledTimes(1);

    app.destroy();
  });

  it('resize callback が dispatch 中に自身を解除しても後続が呼ばれ例外にならない', () => {
    const app = new DomSyncGL(container);
    const order: string[] = [];
    let unsubscribeSelf!: () => void;
    unsubscribeSelf = app.addResizeCallback(() => {
      order.push('a');
      unsubscribeSelf();
    });
    const cbB = vi.fn(() => order.push('b'));
    app.addResizeCallback(cbB);

    const runResize = (app as unknown as { onResize: () => void }).onResize.bind(
      app
    );
    expect(() => runResize()).not.toThrow();
    expect(order).toEqual(['a', 'b']);
    expect(cbB).toHaveBeenCalledTimes(1);
    // 自身は解除済みなので次回の resize では呼ばれない
    runResize();
    expect(order).toEqual(['a', 'b', 'b']);

    app.destroy();
  });

  it('getScene / getCamera / getRenderer が初期化済みインスタンスを返す', () => {
    const app = new DomSyncGL(container);
    expect(app.getScene()).toBeDefined();
    expect(app.getCamera()).toBeDefined();
    expect(app.getRenderer()).toBeDefined();
    expect(app.getViewPort()).toBeDefined();
    app.destroy();
  });

  it('getScroll() が確定スクロール値のキャッシュ {x, y} を返す', () => {
    // Given: 初期化直後の DomSyncGL（jsdom の window.scroll* は 0）
    const app = new DomSyncGL(container);

    // When: Core が保持するキャッシュ済みスクロール値を取得する
    const scroll = app.getScroll();

    // Then: 数値 x / y を持つ 1 組のオブジェクトを返す（座標計算経路の唯一のスクロール源）
    expect(typeof scroll.x).toBe('number');
    expect(typeof scroll.y).toBe('number');
    expect(scroll.x).toBe(0);
    expect(scroll.y).toBe(0);

    app.destroy();
  });

  it('getScroll() は live なキャッシュ参照を返す（毎回同一オブジェクト）', () => {
    // Given: 初期化済みの DomSyncGL
    const app = new DomSyncGL(container);

    // When: getScroll() を 2 回呼ぶ
    const first = app.getScroll();
    const second = app.getScroll();

    // Then: getMouse() と同じく live 参照を返し、ゼロアロケートで同一オブジェクトを共有する
    expect(second).toBe(first);

    app.destroy();
  });

  it('onResize() はスクロールキャッシュを更新し、getScroll() が新しいスクロール値を反映する', () => {
    // Given: ScrollSync 無効の DomSyncGL（種付け時の window.scroll* は 0）
    const app = new DomSyncGL(container);
    expect(app.getScroll()).toEqual({ x: 0, y: 0 });

    // And: window のスクロール位置が変化している（resize ハンドラが走る前の状態）
    Object.defineProperty(window, 'scrollX', {
      value: 120,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'scrollY', {
      value: 340,
      writable: true,
      configurable: true,
    });

    // When: resize 経路（debounce 後に呼ばれる private onResize）が走る
    (app as unknown as { onResize: () => void }).onResize();

    // Then: plane/obj.resize() が読む _scroll キャッシュが rect 読み取りと同一時刻の値に更新される
    expect(app.getScroll()).toEqual({ x: 120, y: 340 });

    Object.defineProperty(window, 'scrollX', {
      value: 0,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'scrollY', {
      value: 0,
      writable: true,
      configurable: true,
    });
    app.destroy();
  });

  it('onResize() は ScrollSync 有効時に effectiveScrollY をキャッシュへ反映する', () => {
    // Given: ScrollSync 有効の DomSyncGL
    const app = new DomSyncGL(container, { scrollSync: true });

    // And: documentElement の rubber-band 状態（BCR.top = -500 → effectiveScrollY = 500）
    vi.spyOn(
      document.documentElement,
      'getBoundingClientRect'
    ).mockReturnValue(new DOMRect(0, -500, 1024, 768));

    // When: resize 経路が走る
    (app as unknown as { onResize: () => void }).onResize();

    // Then: window.scrollY の生値ではなく computeEffectiveScrollY() の補正値を共有する
    expect(app.getScroll().y).toBe(500);

    app.destroy();
  });

  it('destroy() を 2 回呼んでも例外にならない（冪等）', () => {
    const app = new DomSyncGL(container);
    app.destroy();
    expect(() => app.destroy()).not.toThrow();
  });

  describe('createTextPlane の配線', () => {
    beforeEach(() => {
      // createTextPlane は要素必須のため DomPlane 内部で IntersectionObserver を生成する。
      // 既存の createPlane(null) テストは使わない経路なので、このブロックだけスタブする。
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(_callback: IntersectionObserverCallback) {}
          observe() {}
          unobserve() {}
          disconnect() {}
        }
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function makeTextEl(): HTMLElement {
      const el = document.createElement('div');
      el.textContent = 'hello';
      el.className = 'text-target';
      document.body.appendChild(el);
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, 200, 100)
      );
      return el;
    }

    it('removePlane(textPlane) 後に domPlanes が空になる', () => {
      const app = new DomSyncGL(container);
      makeTextEl();
      const plane = app.createTextPlane('.text-target');

      expect(app.domPlanes).toContain(plane);

      app.removePlane(plane);

      expect(app.domPlanes.length).toBe(0);
      app.destroy();
    });

    it('gui オプションあり → _setGui 経由で addEffect の setupGUI が呼ばれる', () => {
      const gui = { destroy: vi.fn() } as unknown as GUI;
      const app = new DomSyncGL(container, { gui });
      makeTextEl();
      const plane = app.createTextPlane('.text-target');
      const effect = new TestEffect();
      effect.setupGUI = vi.fn();

      plane.addEffect(effect);

      expect(effect.setupGUI).toHaveBeenCalledWith(gui);
      app.destroy();
    });

    it('destroy 済みインスタンスで createTextPlane → throw', () => {
      const app = new DomSyncGL(container);
      makeTextEl();
      app.destroy();
      expect(() => app.createTextPlane('.text-target')).toThrow(/destroy 済み/);
    });
  });

  describe('子オブジェクトの直接 destroy で registry から解除される（CR-14）', () => {
    type CoreInternals = {
      domPlaneMeshes: THREE.Mesh[];
      domPlaneByMesh: Map<THREE.Mesh, unknown>;
    };

    beforeEach(() => {
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(_callback: IntersectionObserverCallback) {}
          observe() {}
          unobserve() {}
          disconnect() {}
        }
      );
      // Core.test は three の GLTFLoader を差し替えないため、実ファイル取得を止める。
      vi.spyOn(GLTFLoader.prototype, 'load').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function makeEl(cls: string): HTMLElement {
      const el = document.createElement('div');
      el.className = cls;
      document.body.appendChild(el);
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, 100, 100)
      );
      return el;
    }

    it('plane.destroy() 直接呼び出しで domPlanes / raycast 配列・Map から消え、tick 更新対象にならない', () => {
      const app = new DomSyncGL(container);
      makeEl('plane-a');
      const plane = app.createPlane('.plane-a')!;
      const mesh = plane.getMesh();
      const internals = app as unknown as CoreInternals;

      expect(app.domPlanes).toContain(plane);
      expect(internals.domPlaneMeshes).toContain(mesh);
      expect(internals.domPlaneByMesh.has(mesh)).toBe(true);

      const tickSpy = vi.spyOn(plane, '_tickApply');
      plane.destroy();

      expect(app.domPlanes).not.toContain(plane);
      expect(internals.domPlaneMeshes).not.toContain(mesh);
      expect(internals.domPlaneByMesh.has(mesh)).toBe(false);

      app.tick();
      expect(tickSpy).not.toHaveBeenCalled();
      app.destroy();
    });

    it('dom3DObject.destroy() 直接呼び出しで dom3DObjects から消える', () => {
      const app = new DomSyncGL(container);
      makeEl('obj-a');
      const obj = app.create3DObject('.obj-a', { modelPath: 'dummy.glb' });

      expect(app.dom3DObjects).toContain(obj);
      obj.destroy();
      expect(app.dom3DObjects).not.toContain(obj);
      app.destroy();
    });

    it('removePlane() は destroy を 1 回だけ呼び、registry からも消える（二重 destroy にならない）', () => {
      const app = new DomSyncGL(container);
      makeEl('plane-b');
      const plane = app.createPlane('.plane-b')!;
      const mesh = plane.getMesh();
      const internals = app as unknown as CoreInternals;
      const destroySpy = vi.spyOn(plane, 'destroy');

      app.removePlane(plane);

      expect(destroySpy).toHaveBeenCalledTimes(1);
      expect(app.domPlanes).not.toContain(plane);
      expect(internals.domPlaneMeshes).not.toContain(mesh);
      expect(internals.domPlaneByMesh.has(mesh)).toBe(false);

      // 解除済みへの再 removePlane も destroy が idempotent なので安全
      expect(() => app.removePlane(plane)).not.toThrow();
      app.destroy();
    });

    it('app.destroy() で複数 plane が全て破棄される（splice によるスキップが起きない）', () => {
      const app = new DomSyncGL(container);
      makeEl('p1');
      makeEl('p2');
      makeEl('p3');
      const planes = [
        app.createPlane('.p1')!,
        app.createPlane('.p2')!,
        app.createPlane('.p3')!,
      ];
      const spies = planes.map((p) => vi.spyOn(p, 'destroy'));

      app.destroy();

      for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
      expect(app.domPlanes).toEqual([]);
    });
  });

  describe('container resize 追従と公開 resize()（CR-13）', () => {
    let roCallback: ResizeObserverCallback | null;
    let roObserve: ReturnType<typeof vi.fn>;
    let roDisconnect: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      roCallback = null;
      roObserve = vi.fn();
      roDisconnect = vi.fn();
      // jsdom は ResizeObserver 未実装のため、コールバックを捕捉するモックを注入する。
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(cb: ResizeObserverCallback) {
            roCallback = cb;
          }
          observe = roObserve;
          unobserve() {}
          disconnect = roDisconnect;
        }
      );
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('ResizeObserver の発火で debounce 経過後に onResize が走る', () => {
      const app = new DomSyncGL(container);
      expect(roObserve).toHaveBeenCalledWith(container);

      const onResizeSpy = vi.spyOn(
        app as unknown as { onResize: () => void },
        'onResize'
      );

      roCallback!([], {} as ResizeObserver);
      // debounce 前は未実行
      expect(onResizeSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      expect(onResizeSpy).toHaveBeenCalledTimes(1);

      app.destroy();
    });

    it('公開 resize() は debounce を挟まず即座に onResize を実行する', () => {
      const app = new DomSyncGL(container);
      const onResizeSpy = vi.spyOn(
        app as unknown as { onResize: () => void },
        'onResize'
      );

      app.resize();

      expect(onResizeSpy).toHaveBeenCalledTimes(1);
      app.destroy();
    });

    it('destroy 済みインスタンスの resize() は no-op', () => {
      const app = new DomSyncGL(container);
      app.destroy();
      const onResizeSpy = vi.spyOn(
        app as unknown as { onResize: () => void },
        'onResize'
      );

      app.resize();

      expect(onResizeSpy).not.toHaveBeenCalled();
    });

    it('destroy() で ResizeObserver が disconnect される', () => {
      const app = new DomSyncGL(container);
      app.destroy();
      expect(roDisconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('update() / render() 分割（CR-05）', () => {
    it('update() は GPU 描画パス（render / setRenderTarget）を一切呼ばない', async () => {
      const app = new DomSyncGL(container);
      // ready ガードで no-op になっているだけではないことを保証するため init 完了後に検証
      await app.ready;
      const renderer = app.getRenderer();
      const renderSpy = vi.spyOn(renderer, 'render');
      const setRTSpy = vi.spyOn(renderer, 'setRenderTarget');

      app.update();

      expect(renderSpy).not.toHaveBeenCalled();
      expect(setRTSpy).not.toHaveBeenCalled();
      app.destroy();
    });

    it('render() を単独で呼んでも（update 未実行でも）例外にならない', () => {
      const app = new DomSyncGL(container);
      expect(() => app.render()).not.toThrow();
      app.destroy();
    });

    it('tick() は update() → render() を順に呼ぶ', () => {
      const app = new DomSyncGL(container);
      const updateSpy = vi.spyOn(app, 'update');
      const renderSpy = vi.spyOn(app, 'render');

      app.tick();

      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(renderSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy.mock.invocationCallOrder[0]).toBeLessThan(
        renderSpy.mock.invocationCallOrder[0],
      );
      app.destroy();
    });

    it('destroy 済みで update() / render() は no-op', () => {
      const app = new DomSyncGL(container);
      app.destroy();
      const renderer = app.getRenderer();
      const renderSpy = vi.spyOn(renderer, 'render');
      const setRTSpy = vi.spyOn(renderer, 'setRenderTarget');

      expect(() => app.update()).not.toThrow();
      expect(() => app.render()).not.toThrow();
      expect(renderSpy).not.toHaveBeenCalled();
      expect(setRTSpy).not.toHaveBeenCalled();
    });

    it('render({ outputTarget }) は postEffect 無し経路で最終出力を outputTarget へ向ける', async () => {
      const app = new DomSyncGL(container);
      await app.ready;
      const renderer = app.getRenderer();
      const setRTSpy = vi.spyOn(renderer, 'setRenderTarget');
      const rt = {} as THREE.RenderTarget;

      app.render({ outputTarget: rt });

      expect(setRTSpy).toHaveBeenCalledWith(rt);
      app.destroy();
    });

    it('render({ outputTarget }) は EffectComposer 経路でも最終出力を outputTarget へ向ける', async () => {
      const app = new DomSyncGL(container);
      app.addEffect(new TestEffect());
      await app.ready;
      const renderer = app.getRenderer();
      const setRTSpy = vi.spyOn(renderer, 'setRenderTarget');
      const rt = {} as THREE.RenderTarget;

      app.render({ outputTarget: rt });

      expect(setRTSpy).toHaveBeenCalledWith(rt);
      app.destroy();
    });

    it('外部 RT をバインドした状態で render() しても、呼び出し後に元の RT が復元される（postEffect 無し経路）', async () => {
      const app = new DomSyncGL(container);
      await app.ready;
      const renderer = app.getRenderer();
      const ext = {} as THREE.RenderTarget;
      renderer.setRenderTarget(ext);

      app.render();

      expect(renderer.getRenderTarget()).toBe(ext);
      app.destroy();
    });

    it('外部 RT をバインドした状態で render() しても、呼び出し後に元の RT が復元される（EffectComposer 経路）', async () => {
      const app = new DomSyncGL(container);
      app.addEffect(new TestEffect());
      await app.ready;
      const renderer = app.getRenderer();
      const ext = {} as THREE.RenderTarget;
      renderer.setRenderTarget(ext);

      app.render();

      expect(renderer.getRenderTarget()).toBe(ext);
      app.destroy();
    });
  });

  describe('ready / 非同期初期化（WebGPU 移行）', () => {
    it('render() は renderer.init() 完了前は no-op、ready 解決後に描画する', async () => {
      const app = new DomSyncGL(container);
      const renderer = app.getRenderer();
      const renderSpy = vi.spyOn(renderer, 'render');

      // init はマイクロタスクで解決するため、同期呼び出し時点ではまだ未完了
      app.render();
      expect(renderSpy).not.toHaveBeenCalled();

      await app.ready;
      app.render();
      expect(renderSpy).toHaveBeenCalledTimes(1);
      app.destroy();
    });

    it('isWebGPUBackend() は init 前 false、init 後は backend の判定値を返す', async () => {
      const app = new DomSyncGL(container);
      expect(app.isWebGPUBackend()).toBe(false);

      await app.ready;
      // MockWebGPURenderer の backend は isWebGPUBackend: true
      expect(app.isWebGPUBackend()).toBe(true);
      app.destroy();
    });

    it('ready 解決前に destroy() しても例外にならない', async () => {
      const app = new DomSyncGL(container);
      expect(() => app.destroy()).not.toThrow();
      await expect(app.ready).resolves.toBeUndefined();
    });
  });

  describe("オフスクリーン停止（pauseWhenOffscreen / attach: 'dom'）", () => {
    let ioCallback: IntersectionObserverCallback | null;
    let ioOptions: IntersectionObserverInit | undefined;
    let ioObserve: ReturnType<typeof vi.fn>;
    let ioDisconnect: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      ioCallback = null;
      ioOptions = undefined;
      ioObserve = vi.fn();
      ioDisconnect = vi.fn();
      // jsdom は IntersectionObserver 未実装のため、コールバックを捕捉するモックを注入する。
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(
            cb: IntersectionObserverCallback,
            opts?: IntersectionObserverInit
          ) {
            ioCallback = cb;
            ioOptions = opts;
          }
          observe = ioObserve;
          unobserve() {}
          disconnect = ioDisconnect;
        }
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    // isIntersecting だけ見る最小 entry（実装は他のフィールドを読まない）
    const fire = (isIntersecting: boolean) =>
      ioCallback!(
        [{ isIntersecting } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );

    const domApp = (opts: Record<string, unknown> = {}) =>
      new DomSyncGL(container, {
        scrollSync: { attach: 'dom' },
        pauseWhenOffscreen: true,
        ...opts,
      });

    const rafCount = () =>
      vi.mocked(window.requestAnimationFrame).mock.calls.length;

    it('dom モード + opt-in で container を rootMargin 100% で監視する', () => {
      const app = domApp();
      expect(ioObserve).toHaveBeenCalledWith(container);
      expect(ioOptions?.rootMargin).toBe('100%');
      app.destroy();
    });

    it('pauseRootMargin を渡すとその値が rootMargin に使われる', () => {
      const app = domApp({ pauseRootMargin: '0px' });
      expect(ioOptions?.rootMargin).toBe('0px');
      app.destroy();
    });

    it('pauseWhenOffscreen 未指定なら observer を生成しない（既存挙動不変）', () => {
      const app = new DomSyncGL(container, { scrollSync: { attach: 'dom' } });
      expect(ioCallback).toBeNull();
      expect(app.isPaused()).toBe(false);
      app.destroy();
    });

    it("attach: 'translate' で opt-in しても監視せず DEV warn を出す", () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const app = new DomSyncGL(container, {
        scrollSync: { attach: 'translate' },
        pauseWhenOffscreen: true,
      });

      expect(ioCallback).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      app.destroy();
    });

    it('scrollSync 無しで opt-in しても監視しない', () => {
      const app = new DomSyncGL(container, { pauseWhenOffscreen: true });
      expect(ioCallback).toBeNull();
      app.destroy();
    });

    it('オフスクリーンで rAF を解除し、以後 tick() が update/render を呼ばない', () => {
      const app = domApp();
      const updateSpy = vi.spyOn(app, 'update');
      const renderSpy = vi.spyOn(app, 'render');

      fire(false);

      expect(app.isPaused()).toBe(true);
      expect(window.cancelAnimationFrame).toHaveBeenCalled();

      app.tick();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(renderSpy).not.toHaveBeenCalled();

      app.destroy();
    });

    it('画面内に戻ると停止が解除されループが再開する', () => {
      const app = domApp();
      fire(false);
      const before = rafCount();

      fire(true);

      expect(app.isPaused()).toBe(false);
      expect(rafCount()).toBe(before + 1);
      app.destroy();
    });

    it('復帰通知が連続しても rAF ループは 1 本しか走らない', () => {
      const app = domApp();
      fire(false);
      const before = rafCount();

      fire(true);
      fire(true);

      expect(rafCount()).toBe(before + 1);
      app.destroy();
    });

    it('復帰時に elapsed が停止時間ぶん飛ばない', () => {
      let mockNow = 1000;
      vi.spyOn(performance, 'now').mockImplementation(() => mockNow);

      const app = domApp();
      // 構築時の tick で clock が start 済み。ここを基準にする。
      const elapsedBefore = app.clock.getElapsedTime();

      fire(false);
      mockNow += 10_000;
      fire(true);

      // 復帰の startLoop() で 1 フレーム回っている
      expect(app.clock.getElapsedTime() - elapsedBefore).toBeLessThan(0.001);
      app.destroy();
    });

    it('復帰時に strength / pointer の前フレーム値を継ぎ直す', () => {
      const app = domApp();
      const sync = app.getScrollSync()!;
      const pointer = app as unknown as {
        pointer: { invalidateRect: () => void; endFrame: () => void };
      };
      const resetSpy = vi.spyOn(sync, 'resetStrengthBaseline');
      const invalidateSpy = vi.spyOn(pointer.pointer, 'invalidateRect');
      const endFrameSpy = vi.spyOn(pointer.pointer, 'endFrame');

      fire(false);
      fire(true);

      expect(resetSpy).toHaveBeenCalledTimes(1);
      expect(invalidateSpy).toHaveBeenCalledTimes(1);
      expect(endFrameSpy).toHaveBeenCalledTimes(1);
      app.destroy();
    });

    it('autoRaf: false でも停止中の tick() は stats を開かず描画しない', () => {
      const app = domApp({ autoRaf: false });
      const updateSpy = vi.spyOn(app, 'update');
      const devTools = app as unknown as {
        devTools: { beginStats: () => void };
      };
      const statsSpy = vi.spyOn(devTools.devTools, 'beginStats');

      fire(false);
      app.tick(0);

      expect(updateSpy).not.toHaveBeenCalled();
      expect(statsSpy).not.toHaveBeenCalled();

      // 復帰後は自前ループからの tick() が通る
      fire(true);
      app.tick(0);
      expect(updateSpy).toHaveBeenCalled();

      app.destroy();
    });

    it('停止中に destroy() しても例外にならず observer を切る', () => {
      const app = domApp();
      fire(false);

      expect(() => app.destroy()).not.toThrow();
      expect(ioDisconnect).toHaveBeenCalledTimes(1);
    });

    it('destroy() 後の通知はループを再開させない', () => {
      const app = domApp();
      fire(false);
      app.destroy();
      const before = rafCount();

      expect(() => fire(true)).not.toThrow();
      expect(rafCount()).toBe(before);
      expect(app.isPaused()).toBe(true);
    });

    it('IntersectionObserver 非対応環境では停止せず従来どおり回る', () => {
      vi.stubGlobal('IntersectionObserver', undefined);

      const app = domApp();
      expect(app.isPaused()).toBe(false);
      expect(() => app.tick()).not.toThrow();
      app.destroy();
    });
  });
});
