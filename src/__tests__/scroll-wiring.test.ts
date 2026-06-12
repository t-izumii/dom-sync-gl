import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// WebGLRenderer は WebGL コンテキストを要求し jsdom では失敗するためスタブ化（Core.test と同方針）。
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

// OrbitControls は実 DOM の pointer events を多数触るためスタブ化。
vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: class {
    update() {}
    dispose() {}
  },
}));

// GLTFLoader は実ファイル取得を行うため、create3DObject ctor の配線検証では load を no-op にする。
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    load() {}
  },
}));

import { WebGLApp } from '../Core';
import { RafScroll } from '../RafScroll';
import type { DomPlane } from '../DomPlane';
import type { Dom3DObject } from '../Dom3DObject';

// DomPlane / Dom3DObject が Core から注入された live スクロール参照を保持しているかを
// private フィールド経由で確認するためのアクセサ型（TS の private は実行時には素通し）。
type WithScroll = { scroll: { x: number; y: number } };

describe('Core → DomPlane / Dom3DObject のスクロール配線', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 800, 600)
    );
    // jsdom に IntersectionObserver は無いので最小スタブを差す（createPlane/create3DObject が要求）。
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    // rAF の連鎖実行はテストノイズになるので no-op に。
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('createPlane が生成した plane は Core の getScroll() と同一の live 参照を保持する', () => {
    // Given: 初期化済みの WebGLApp と DOM 要素
    const app = new WebGLApp(container);
    const el = document.createElement('div');
    document.body.appendChild(el);

    // When: public API で plane を生成する
    const plane = app.createPlane(el) as DomPlane;

    // Then: plane が読むスクロール源は Core の _scroll キャッシュそのもの（直読み回帰なら参照が一致しない）
    expect((plane as unknown as WithScroll).scroll).toBe(app.getScroll());

    app.destroy();
  });

  it('onResize 後のキャッシュ更新が plane の保持する参照へ live に反映される', () => {
    // Given: plane を生成済み（初期 window.scroll* は 0）
    const app = new WebGLApp(container);
    const el = document.createElement('div');
    document.body.appendChild(el);
    const plane = app.createPlane(el) as DomPlane;
    expect((plane as unknown as WithScroll).scroll).toEqual({ x: 0, y: 0 });

    // And: window のスクロール位置が変化している
    Object.defineProperty(window, 'scrollX', {
      value: 75,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'scrollY', {
      value: 210,
      writable: true,
      configurable: true,
    });

    // When: resize 経路でキャッシュが更新される
    (app as unknown as { onResize: () => void }).onResize();

    // Then: plane が保持する参照は同一オブジェクトのまま新しい値を映す（コピー配線なら更新が届かない）
    expect((plane as unknown as WithScroll).scroll).toBe(app.getScroll());
    expect((plane as unknown as WithScroll).scroll).toEqual({ x: 75, y: 210 });

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

  it('create3DObject が生成した object も Core の getScroll() と同一の live 参照を保持する', () => {
    // Given: 初期化済みの WebGLApp と DOM 要素
    const app = new WebGLApp(container);
    const el = document.createElement('div');
    document.body.appendChild(el);

    // When: public API で 3D object を生成する（GLTF load は mock で no-op、ctor 時点の配線のみ検証）
    const obj = app.create3DObject(el, { modelPath: 'dummy.glb' }) as Dom3DObject;

    // Then: object が読むスクロール源も Core の _scroll キャッシュそのもの
    expect((obj as unknown as WithScroll).scroll).toBe(app.getScroll());

    app.destroy();
  });
});

describe('Core ⇄ RafScroll の統合（rafScroll オプション）', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 800, 600)
    );
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
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

  it('rafScroll 未指定なら getRafScroll() は null', () => {
    const app = new WebGLApp(container);
    expect(app.getRafScroll()).toBeNull();
    app.destroy();
  });

  it('rafScroll オプションで管理下の RafScroll を構築し getRafScroll() で取得できる', () => {
    const app = new WebGLApp(container, { rafScroll: true });
    expect(app.getRafScroll()).toBeInstanceOf(RafScroll);
    app.destroy();
  });

  it('animate ループ内で RafScroll.advance() を refreshScrollCache() より前に駆動する', () => {
    // Given: 管理下 RafScroll を持つ app
    const app = new WebGLApp(container, { rafScroll: true });
    const rs = app.getRafScroll();
    expect(rs).not.toBeNull();

    // When: advance / refreshScrollCache の呼び出し順を記録して 1 フレーム回す
    const order: string[] = [];
    vi.spyOn(rs!, 'advance').mockImplementation(() => {
      order.push('advance');
    });
    vi.spyOn(
      app as unknown as { refreshScrollCache: () => void },
      'refreshScrollCache'
    ).mockImplementation(() => {
      order.push('refresh');
    });
    (app as unknown as { animate: () => void }).animate();

    // Then: scrollTo(advance) → scroll 読み取り(refresh) の順（= 背景がズレない不変条件）
    expect(order).toEqual(['advance', 'refresh']);
    app.destroy();
  });
});
