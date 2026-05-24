import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Three.js の WebGLRenderer は WebGL コンテキストを要求するため jsdom では失敗する。
// 機能テストに不要な部分なのでクラス全体を差し替える。
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
    render() {}
    dispose() {}
  }
  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer,
  };
});

// OrbitControls は実 DOM API（pointer events）を多数触るのでスタブ化
vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: class {
    update() {}
    dispose() {}
  },
}));

import { WebGLApp } from '../Core';

describe('WebGLApp', () => {
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
    const app = new WebGLApp(container);
    expect(container.contains(app.canvas)).toBe(true);
    app.destroy();
  });

  it('存在しないセレクタを渡すと例外を投げる', () => {
    expect(() => new WebGLApp('#does-not-exist')).toThrow(/Container not found/);
  });

  it('addUpdateCallback は callback を登録し、戻り値で解除できる', () => {
    const app = new WebGLApp(container);
    const cb = vi.fn();
    const unsubscribe = app.addUpdateCallback(cb);

    expect(app.updateCallbacks).toContain(cb);
    unsubscribe();
    expect(app.updateCallbacks).not.toContain(cb);

    app.destroy();
  });

  it('addResizeCallback も同様に登録／解除できる', () => {
    const app = new WebGLApp(container);
    const cb = vi.fn();
    const unsubscribe = app.addResizeCallback(cb);

    expect(app.resizeCallbacks).toContain(cb);
    unsubscribe();
    expect(app.resizeCallbacks).not.toContain(cb);

    app.destroy();
  });

  it('destroy() で AbortController の signal が aborted=true になる', () => {
    const app = new WebGLApp(container);
    const signal = (app as unknown as { eventAbort: AbortController }).eventAbort
      .signal;
    expect(signal.aborted).toBe(false);

    app.destroy();
    expect(signal.aborted).toBe(true);
  });

  it('destroy() で rAF がキャンセルされ canvas が DOM から外れる', () => {
    const app = new WebGLApp(container);
    const canvas = app.canvas;
    expect(container.contains(canvas)).toBe(true);

    app.destroy();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
    expect(container.contains(canvas)).toBe(false);
  });

  it('destroy() で domPlanes / dom3DObjects / callbacks 配列が空になる', () => {
    const app = new WebGLApp(container);
    app.addUpdateCallback(() => {});
    app.addResizeCallback(() => {});

    app.destroy();
    expect(app.updateCallbacks).toEqual([]);
    expect(app.resizeCallbacks).toEqual([]);
    expect(app.domPlanes).toEqual([]);
    expect(app.dom3DObjects).toEqual([]);
  });

  it('clearEffects はエフェクトが登録されていなくても安全に呼べる', () => {
    const app = new WebGLApp(container);
    expect(() => app.clearEffects()).not.toThrow();
    app.destroy();
  });

  it('removePostEffect は clearEffects のエイリアスとして動作する', () => {
    const app = new WebGLApp(container);
    expect(() => app.removePostEffect()).not.toThrow();
    app.destroy();
  });

  it('addUpdateCallback の解除関数は重複呼び出しに耐える', () => {
    const app = new WebGLApp(container);
    const cb = vi.fn();
    const unsubscribe = app.addUpdateCallback(cb);

    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
    expect(app.updateCallbacks).not.toContain(cb);

    app.destroy();
  });

  it('getScene / getCamera / getRenderer が初期化済みインスタンスを返す', () => {
    const app = new WebGLApp(container);
    expect(app.getScene()).toBeDefined();
    expect(app.getCamera()).toBeDefined();
    expect(app.getRenderer()).toBeDefined();
    expect(app.getViewPort()).toBeDefined();
    app.destroy();
  });

  it('destroy() を 2 回呼んでも例外にならない（冪等）', () => {
    const app = new WebGLApp(container);
    app.destroy();
    expect(() => app.destroy()).not.toThrow();
  });
});
