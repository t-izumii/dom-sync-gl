import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// WebGPURenderer は GPU device を要求し jsdom では失敗するためスタブ化（Core.test と同方針）。
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

import * as THREE from 'three/webgpu';
import { texture } from 'three/tsl';
import { DomSyncGL } from '../Core';
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

  it('移動したplaneを同じフレームに実raycastでhover判定する', () => {
    const app = new DomSyncGL(container, { autoRaf: false });
    vi.spyOn(app.canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600));
    const el = document.createElement('div');
    const rect = vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100));
    const plane = app.createPlane(el, { updateRectEveryFrame: true });
    plane.isVisible = true; plane.mesh.visible = true;
    const event = new Event('pointermove');
    Object.assign(event, { pointerType: 'mouse', pointerId: 1, clientX: 400, clientY: 300 });
    window.dispatchEvent(event);
    app.update();
    expect(plane.isHovered()).toBe(false);
    rect.mockReturnValue(new DOMRect(350, 250, 100, 100));
    app.update();
    expect(plane.isHovered()).toBe(true);
    expect(plane.getMouseUV().x).toBeCloseTo(0.5);
    expect(plane.getMouseUV().y).toBeCloseTo(0.5);
    rect.mockReturnValue(new DOMRect(0, 0, 100, 100));
    app.update();
    expect(plane.isHovered()).toBe(false);
    app.destroy();
  });

  it.each([
    { scrollSync: false as const, fixed: false },
    { scrollSync: { attach: 'dom' as const }, fixed: false },
    { scrollSync: false as const, fixed: true },
    { scrollSync: { attach: 'dom' as const }, fixed: true },
  ])('canvas のスクロールに plane/3D object が同期する: %j', ({ scrollSync, fixed }) => {
    let scrollX = 0;
    let scrollY = 0;
    vi.spyOn(window, 'scrollX', 'get').mockImplementation(() => scrollX);
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY);
    vi.spyOn(document.documentElement, 'getBoundingClientRect')
      .mockImplementation(() => new DOMRect(-scrollX, -scrollY, 1600, 2000));
    vi.mocked(container.getBoundingClientRect).mockImplementation(() =>
      new DOMRect(100 - (fixed ? 0 : scrollX), 200 - (fixed ? 0 : scrollY), 800, 600));
    const el = document.createElement('div');
    container.appendChild(el);
    vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() =>
      new DOMRect(150 - scrollX, 250 - scrollY, 100, 100));
    const app = new DomSyncGL(container, { autoRaf: false, scrollSync });
    // updateRectEveryFrame が false でも、共有 canvasRect の更新で追従する。
    const plane = app.createPlane(el);
    plane.isVisible = true;
    const obj = app.create3DObject(el, { modelPath: 'dummy.glb' });
    obj.model = new THREE.Group(); // GLTF 取得はスタブ。位置計算には実際の Group を使う。
    obj.isVisible = true;
    obj.resize();
    const planeBefore = plane.mesh.position.clone();
    const objectBefore = obj.model.position.clone();

    scrollX = 30;
    scrollY = 100;
    app.update();
    const dx = fixed ? -30 : 0;
    const dy = fixed ? 100 : 0;
    expect(plane.mesh.position.x).toBe(planeBefore.x + dx);
    expect(plane.mesh.position.y).toBe(planeBefore.y + dy);
    expect(obj.model.position.x).toBe(objectBefore.x + dx);
    expect(obj.model.position.y).toBe(objectBefore.y + dy);
    if (scrollSync) expect(app.getScrollSync()!.logicalRect).toBe(plane.canvasRect);
    app.destroy();
  });

  it('createPlane が生成した plane は Core の getScroll() と同一の live 参照を保持する', () => {
    // Given: 初期化済みの DomSyncGL と DOM 要素
    const app = new DomSyncGL(container);
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
    const app = new DomSyncGL(container);
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
    // Given: 初期化済みの DomSyncGL と DOM 要素
    const app = new DomSyncGL(container);
    const el = document.createElement('div');
    document.body.appendChild(el);

    // When: public API で 3D object を生成する（GLTF load は mock で no-op、ctor 時点の配線のみ検証）
    const obj = app.create3DObject(el, { modelPath: 'dummy.glb' }) as Dom3DObject;

    // Then: object が読むスクロール源も Core の _scroll キャッシュそのもの
    expect((obj as unknown as WithScroll).scroll).toBe(app.getScroll());

    app.destroy();
  });

  it('フルスクリーン plane(element 無し)も hover 経路に入り setHoverInfo で hover 状態が更新される', () => {
    // Given: DOM-locked plane を 1 つも作らず、フルスクリーン plane だけを生成
    const app = new DomSyncGL(container);
    const plane = app.createPlane(null) as DomPlane;
    const spy = vi.spyOn(plane, 'setHoverInfo');

    // When: 1 フレーム回す（planeMeshes は空だが、フルスクリーン hover は raycast とは別経路）
    (app as unknown as { animate: () => void }).animate.call(app);

    // Then: 背景 plane も毎フレ setHoverInfo を受ける。mouse 未移動なので inside=false で流れる。
    expect(spy).toHaveBeenCalledWith(false, expect.anything());
    expect(plane.isHovered()).toBe(false);

    app.destroy();
  });

  it('addFeedback: 出力テクスチャが事前宣言した texture ノードに供給され、animate で step 更新される', async () => {
    const app = new DomSyncGL(container);
    // 新契約: outputUniform と同名の texture() ノードを createPlane 側で事前宣言する。
    const uTrailTex = texture(new THREE.Texture());
    // フルスクリーン plane（isVisible=true）にして _tickFeedback が走るようにする
    const plane = app.createPlane(null, {
      uniforms: { uTrailTex },
      colorNode: (ctx) => ctx.uniforms.uTrailTex,
    }) as DomPlane;

    const fb = plane.addFeedback({
      outputNode: (ctx) => ctx.uPrev,
      outputUniform: 'uTrailTex',
      size: 64,
    });

    // 事前宣言したノードへ初期テクスチャが供給されている
    expect(uTrailTex.value).toBe(fb.texture);

    // render は renderer.init() 完了までガードされるため ready を待つ
    await app.ready;

    // animate 1 フレームで _tickFeedback → step → 最新テクスチャを供給
    (app as unknown as { animate: () => void }).animate.call(app);
    expect(uTrailTex.value).toBe(fb.texture);

    // removeFeedback で外すと dispose 済みテクスチャを参照し続けないようプレースホルダへ戻る
    const lastTexture = fb.texture;
    expect(plane.removeFeedback(fb)).toBe(true);
    expect(uTrailTex.value).not.toBe(lastTexture);
    expect((uTrailTex.value as THREE.Texture).isTexture).toBe(true);

    app.destroy();
  });
});
