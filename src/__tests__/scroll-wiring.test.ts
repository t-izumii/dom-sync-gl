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

import { DomSyncGL } from '../Core';
import { RafScroll } from '../RafScroll';
import { BaseEffect, type BaseEffectConfig } from '../effects/BaseEffect';
import type { DomPlane } from '../DomPlane';
import type { Dom3DObject } from '../Dom3DObject';

// generate(生成) + fragmentShader(post 合成) を両方持つテスト用エフェクト。
// addEffect の output で texture / post を切り替えられることを検証するのに使う。
class GenEffect extends BaseEffect {
  protected getConfig(): BaseEffectConfig {
    return {
      generate: {
        fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
        size: 32,
      },
      fragmentShader:
        'uniform sampler2D tDiffuse; uniform sampler2D uGenerated; varying vec2 vUv;' +
        ' void main(){ gl_FragColor = texture2D(tDiffuse, vUv) + texture2D(uGenerated, vUv); }',
    };
  }
}

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

  it('フルスクリーン plane(element 無し)も hover 経路に入り setHoverInfo で uniform が更新される', () => {
    // Given: DOM-locked plane を 1 つも作らず、フルスクリーン plane だけを生成
    const app = new DomSyncGL(container);
    const plane = app.createPlane(null) as DomPlane;
    const spy = vi.spyOn(plane, 'setHoverInfo');

    // When: 1 フレーム回す（planeMeshes は空だが、フルスクリーン hover は raycast とは別経路）
    (app as unknown as { animate: () => void }).animate.call(app);

    // Then: 背景 plane も毎フレ setHoverInfo を受ける。mouse 未移動なので inside=false で流れる。
    expect(spy).toHaveBeenCalledWith(false, expect.anything());
    expect(plane.material.uniforms.uIsHovered.value).toBe(false);

    app.destroy();
  });

  it('addFeedback: 出力テクスチャが plane の uniform に供給され、animate で step 更新される', () => {
    const app = new DomSyncGL(container);
    // フルスクリーン plane（isVisible=true）にして _tickFeedback が走るようにする
    const plane = app.createPlane(null, {
      fragmentShader:
        'uniform sampler2D uTrailTex; varying vec2 vUv; void main(){ gl_FragColor = texture2D(uTrailTex, vUv); }',
    }) as DomPlane;

    const fb = plane.addFeedback({
      fragmentShader: 'void main(){ gl_FragColor = vec4(0.0); }',
      outputUniform: 'uTrailTex',
      size: 64,
    });

    // 出力 uniform が自動で生え、初期テクスチャが供給されている
    expect(plane.material.uniforms.uTrailTex).toBeDefined();
    expect(plane.material.uniforms.uTrailTex.value).toBe(fb.texture);

    // animate 1 フレームで _tickFeedback → step → 最新テクスチャを供給
    (app as unknown as { animate: () => void }).animate.call(app);
    expect(plane.material.uniforms.uTrailTex.value).toBe(fb.texture);

    // removeFeedback で外すと uniform は null に戻る
    expect(plane.removeFeedback(fb)).toBe(true);
    expect(plane.material.uniforms.uTrailTex.value).toBeNull();

    app.destroy();
  });

  it('addEffect output:{uniform}: generate のテクスチャを plane uniform に供給し animate で更新', () => {
    const app = new DomSyncGL(container);
    const plane = app.createPlane(null) as DomPlane; // フルスクリーン(isVisible=true)
    const effect = new GenEffect();

    plane.addEffect(effect, { output: { uniform: 'uGenTex' } });

    // 出力 uniform が自動で生え、初期テクスチャが供給される（post 合成 pass は作られない）
    expect(plane.material.uniforms.uGenTex).toBeDefined();
    expect(plane.material.uniforms.uGenTex.value).not.toBeNull();
    expect(effect.getPass()).toBeNull();

    (app as unknown as { animate: () => void }).animate.call(app);
    expect(plane.material.uniforms.uGenTex.value).not.toBeNull();

    app.destroy();
  });

  it('addEffect output:"post"(generate付き): 合成 pass を作り uGenerated に generate を渡す', () => {
    const app = new DomSyncGL(container);
    const plane = app.createPlane(null) as DomPlane;
    const effect = new GenEffect();

    plane.addEffect(effect, { output: 'post' });

    // 合成 pass ができ、uGenerated uniform を持つ
    const pass = effect.getPass();
    expect(pass).not.toBeNull();
    expect(pass!.material.uniforms.uGenerated).toBeDefined();

    // 1 フレーム回しても例外なく回る（generator step → uGenerated 更新）
    expect(() =>
      (app as unknown as { animate: () => void }).animate.call(app),
    ).not.toThrow();

    // removeEffect で generator(FeedbackBuffer) も一緒に片付く
    expect(plane.removeEffect(effect)).toBe(true);

    app.destroy();
  });

  it('post エフェクト時も mesh.updateMatrixWorld が毎フレ呼ばれ raycast(hover) が機能する', () => {
    const app = new DomSyncGL(container);
    const el = document.createElement('div');
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(50, 60, 200, 150),
    );
    document.body.appendChild(el);
    const plane = app.createPlane(el, {
      updateRectEveryFrame: true,
    }) as DomPlane;
    // DOM-locked plane は IO callback が来るまで非表示。テストでは IO スタブが発火しないので手動で可視化。
    (plane as unknown as { isVisible: boolean }).isVisible = true;

    plane.addEffect(new GenEffect(), { output: 'post' }); // PlaneComposer が mesh を scene から外す

    const mesh = plane.getMesh();
    const spy = vi.spyOn(mesh, 'updateMatrixWorld');

    (app as unknown as { animate: () => void }).animate.call(app);

    // setPosition 経由で毎フレ world 行列が更新される（scene 不在でも raycast が当たるよう）
    expect(spy).toHaveBeenCalled();
    // 単位行列ではなく位置/スケールが反映されている（raycast が正しい場所に当たる）
    const m = mesh.matrixWorld.elements;
    const isIdentity =
      m[0] === 1 && m[5] === 1 && m[10] === 1 && m[12] === 0 && m[13] === 0;
    expect(isIdentity).toBe(false);

    app.destroy();
  });

  it('app.addEffect output:"post"(generate付き): fullscreen 合成 pass を作り generator を駆動する', () => {
    const app = new DomSyncGL(container);
    const effect = new GenEffect();

    // 画面全体(EffectComposer)に対する fullscreen ポスト
    app.addEffect(effect, { output: 'post' });

    const pass = effect.getPass();
    expect(pass).not.toBeNull();
    expect(pass!.material.uniforms.uGenerated).toBeDefined();

    // animate で generator が step され uGenerated が更新される（例外なく回る）
    expect(() =>
      (app as unknown as { animate: () => void }).animate.call(app),
    ).not.toThrow();

    // texture 出力は app 全体では不可（plane.addEffect を使う）
    expect(() =>
      app.addEffect(new GenEffect(), { output: { uniform: 'x' } }),
    ).toThrow();

    // removeEffect で generator も片付く
    expect(app.removeEffect(effect)).toBe(true);

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
    const app = new DomSyncGL(container);
    expect(app.getRafScroll()).toBeNull();
    app.destroy();
  });

  it('rafScroll オプションで管理下の RafScroll を構築し getRafScroll() で取得できる', () => {
    const app = new DomSyncGL(container, { rafScroll: true });
    expect(app.getRafScroll()).toBeInstanceOf(RafScroll);
    app.destroy();
  });

  it('animate ループ内で RafScroll.advance() を refreshScrollCache() より前に駆動する', () => {
    // Given: 管理下 RafScroll を持つ app
    const app = new DomSyncGL(container, { rafScroll: true });
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
