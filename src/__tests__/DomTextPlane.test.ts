import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Three.js の WebGLRenderer は WebGL コンテキストを要求し jsdom では失敗するためスタブ化（DomPlane.test と同方針）。
vi.mock("three", async () => {
  const actual = await vi.importActual<typeof import("three")>("three");
  class MockWebGLRenderer {
    domElement: HTMLCanvasElement;
    outputColorSpace = "";
    private dpr = 1;
    constructor(opts: { canvas?: HTMLCanvasElement }) {
      this.domElement = opts.canvas ?? document.createElement("canvas");
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

vi.mock("three/examples/jsm/controls/OrbitControls.js", () => ({
  OrbitControls: class {
    update() {}
    dispose() {}
  },
}));

import { DomSyncGL } from "../Core";
import { DomTextPlane } from "../DomTextPlane";

// マイクロタスクキューを flush する（DomPlane.test.ts と同方針）。
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface MockCtx {
  scale: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  measureText: ReturnType<typeof vi.fn>;
  font: string;
  fillStyle: string;
  textAlign: string;
  textBaseline: string;
}

function makeCtx(): MockCtx {
  return {
    scale: vi.fn(),
    clearRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((s: string) => ({ width: s.length * 10 })),
    font: "",
    fillStyle: "",
    textAlign: "",
    textBaseline: "",
  };
}

function stubFonts(status: "loaded" | "loading", ready: Promise<unknown>): void {
  Object.defineProperty(document, "fonts", {
    value: { status, ready },
    configurable: true,
  });
}

describe("DomTextPlane", () => {
  let container: HTMLElement;
  let disconnectSpy: ReturnType<typeof vi.fn>;
  let roDisconnectSpy: ReturnType<typeof vi.fn>;
  let roCallbacks: ResizeObserverCallback[];
  let ctx: MockCtx;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 800, 600),
    );

    disconnectSpy = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        private callback: IntersectionObserverCallback;
        constructor(callback: IntersectionObserverCallback) {
          this.callback = callback;
        }
        observe(target: Element) {
          queueMicrotask(() => {
            this.callback(
              [{ isIntersecting: true, target } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver,
            );
          });
        }
        unobserve() {}
        disconnect = disconnectSpy;
      },
    );

    roCallbacks = [];
    roDisconnectSpy = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: ResizeObserverCallback) {
          roCallbacks.push(cb);
        }
        observe() {}
        unobserve() {}
        disconnect = roDisconnectSpy;
      },
    );

    ctx = makeCtx();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);

    stubFonts("loaded", Promise.resolve());

    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // stubFonts で configurable: true にしているので消せる。
    delete (document as unknown as { fonts?: unknown }).fonts;
  });

  function makeTextEl(text = "Hello World", rect = new DOMRect(0, 0, 200, 100)): HTMLElement {
    const el = document.createElement("div");
    el.textContent = text;
    document.body.appendChild(el);
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue(rect);
    return el;
  }

  it("コンストラクタは super() 経由の早すぎる resize() 呼び出しでも例外を投げない（回帰）", () => {
    const app = new DomSyncGL(container);
    const el = makeTextEl();
    expect(
      () =>
        new DomTextPlane(
          el,
          app.getScene(),
          app.getViewPort(),
          app.getScroll(),
          app.getRenderer(),
          {},
        ),
    ).not.toThrow();
    app.destroy();
  });

  describe("生成と配線", () => {
    it("createTextPlane('.sel') が DomTextPlane を返し、app.domPlanes に含まれる", async () => {
      const app = new DomSyncGL(container);
      const el = makeTextEl();
      el.className = "text-target";
      const plane = app.createTextPlane(".text-target");
      await flush();

      expect(app.domPlanes).toContain(plane);
      app.destroy();
    });

    it("セレクタ不一致で throw、destroy 済み app で throw", () => {
      const app = new DomSyncGL(container);
      expect(() => app.createTextPlane(".not-exist")).toThrow(/Element not found/);
      app.destroy();
      expect(() => app.createTextPlane(".not-exist")).toThrow(/destroy 済み/);
    });

    it("data-texture 属性付き要素でも uTexture に CanvasTexture が入ったまま", async () => {
      const app = new DomSyncGL(container);
      const el = makeTextEl();
      el.setAttribute("data-texture", "/some/image.png");
      const plane = app.createTextPlane(el) as DomTextPlane;
      await flush();

      expect(plane.texture).toBeTruthy();
      expect((plane.texture as { isCanvasTexture?: boolean }).isCanvasTexture).toBe(true);
      app.destroy();
    });
  });

  describe("スタイル抽出と描画", () => {
    it("getComputedStyle の color が ctx.fillStyle に反映される", async () => {
      const app = new DomSyncGL(container);
      const el = makeTextEl();
      vi.spyOn(window, "getComputedStyle").mockReturnValue({
        fontSize: "16px",
        fontFamily: "Arial",
        fontWeight: "400",
        fontStyle: "normal",
        color: "rgb(255, 0, 0)",
        lineHeight: "normal",
        letterSpacing: "normal",
        textAlign: "left",
        paddingTop: "0px",
        paddingRight: "0px",
        paddingBottom: "0px",
        paddingLeft: "0px",
      } as CSSStyleDeclaration);

      app.createTextPlane(el);
      await flush();

      expect(ctx.fillStyle).toBe("rgb(255, 0, 0)");
      app.destroy();
    });

    it("options.style.fontSize 上書きが ctx.font に反映される", async () => {
      const app = new DomSyncGL(container);
      const el = makeTextEl();
      app.createTextPlane(el, { style: { fontSize: 40 } });
      await flush();

      expect(ctx.font).toContain("40px");
      app.destroy();
    });

    it("options.text 指定時は textContent ではなくそちらが描画される", async () => {
      const app = new DomSyncGL(container);
      const el = makeTextEl("original text");
      app.createTextPlane(el, { text: "override text" });
      await flush();

      const calledWithOverride = ctx.fillText.mock.calls.some((c) =>
        String(c[0]).includes("override"),
      );
      expect(calledWithOverride).toBe(true);
      app.destroy();
    });
  });

  describe("元要素の非表示", () => {
    it("フォント loaded 状態で生成 → color が transparent になり、destroy() で復元される", async () => {
      const app = new DomSyncGL(container);
      const el = makeTextEl();
      el.style.color = "blue";
      const plane = app.createTextPlane(el) as DomTextPlane;
      await flush();

      expect(el.style.color).toBe("transparent");

      app.removePlane(plane);
      expect(el.style.color).toBe("blue");
      app.destroy();
    });

    it("hideElementText: false → color が変更されない", async () => {
      const app = new DomSyncGL(container);
      const el = makeTextEl();
      el.style.color = "blue";
      app.createTextPlane(el, { hideElementText: false });
      await flush();

      expect(el.style.color).toBe("blue");
      app.destroy();
    });
  });

  describe("フォントロード待ち", () => {
    it("loading 状態では生成直後は fillText 未呼び出し。ready 解決後に呼ばれ transparent になる", async () => {
      let resolveReady!: () => void;
      const ready = new Promise<void>((r) => {
        resolveReady = r;
      });
      stubFonts("loading", ready);

      const app = new DomSyncGL(container);
      const el = makeTextEl();
      el.style.color = "blue";
      app.createTextPlane(el);
      await flush();

      expect(ctx.fillText).not.toHaveBeenCalled();
      expect(el.style.color).toBe("blue");

      resolveReady();
      await flush();

      expect(ctx.fillText).toHaveBeenCalled();
      expect(el.style.color).toBe("transparent");
      app.destroy();
    });

    it("ready 解決前に removePlane すると解決後も fillText が呼ばれない（destroy ガード回帰）", async () => {
      let resolveReady!: () => void;
      const ready = new Promise<void>((r) => {
        resolveReady = r;
      });
      stubFonts("loading", ready);

      const app = new DomSyncGL(container);
      const el = makeTextEl();
      const plane = app.createTextPlane(el) as DomTextPlane;
      await flush();

      app.removePlane(plane);
      resolveReady();
      await flush();

      expect(ctx.fillText).not.toHaveBeenCalled();
      app.destroy();
    });
  });

  describe("setText", () => {
    it("setText('new') で textContent が更新され、fillText が新テキストで再呼び出しされ needsUpdate が立つ", async () => {
      const app = new DomSyncGL(container);
      const el = makeTextEl("initial");
      const plane = app.createTextPlane(el) as DomTextPlane;
      await flush();
      ctx.fillText.mockClear();

      plane.setText("brand new text");

      expect(el.textContent).toBe("brand new text");
      const calledWithNew = ctx.fillText.mock.calls.some((c) =>
        String(c[0]).includes("brand"),
      );
      expect(calledWithNew).toBe(true);
      app.destroy();
    });
  });

  describe("リサイズ・再ラスタライズ", () => {
    it("rect 同サイズで resize() しても再 clearRect されない", async () => {
      const app = new DomSyncGL(container);
      const el = makeTextEl("text", new DOMRect(0, 0, 200, 100));
      const plane = app.createTextPlane(el) as DomTextPlane;
      await flush();
      ctx.clearRect.mockClear();

      plane.resize();

      expect(ctx.clearRect).not.toHaveBeenCalled();
      app.destroy();
    });

    it("getBoundingClientRect の戻りを変えて resize() すると再ラスタライズされる", async () => {
      const app = new DomSyncGL(container);
      const el = makeTextEl("text", new DOMRect(0, 0, 200, 100));
      const plane = app.createTextPlane(el) as DomTextPlane;
      await flush();
      ctx.clearRect.mockClear();

      vi.spyOn(el, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, 300, 150),
      );
      plane.resize();

      expect(ctx.clearRect).toHaveBeenCalled();
      app.destroy();
    });

    it("ResizeObserver コールバック発火（rect 変更済み）で再ラスタライズされる", async () => {
      const app = new DomSyncGL(container);
      const el = makeTextEl("text", new DOMRect(0, 0, 200, 100));
      app.createTextPlane(el) as DomTextPlane;
      await flush();
      ctx.clearRect.mockClear();

      vi.spyOn(el, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, 400, 200),
      );
      expect(roCallbacks.length).toBeGreaterThan(0);
      roCallbacks[0]([], {} as ResizeObserver);

      expect(ctx.clearRect).toHaveBeenCalled();
      app.destroy();
    });

    it("rect 0×0（display:none 想定）ではラスタライズをスキップし、クラッシュしない。復帰後の resize() で描画される", async () => {
      const app = new DomSyncGL(container);
      const el = makeTextEl("text", new DOMRect(0, 0, 0, 0));
      const plane = app.createTextPlane(el) as DomTextPlane;
      await flush();

      expect(ctx.fillText).not.toHaveBeenCalled();

      vi.spyOn(el, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, 200, 100),
      );
      expect(() => plane.resize()).not.toThrow();
      expect(ctx.fillText).toHaveBeenCalled();
      app.destroy();
    });
  });

  describe("dispose", () => {
    it("removePlane で CanvasTexture.dispose が呼ばれる", async () => {
      const app = new DomSyncGL(container);
      const el = makeTextEl();
      const plane = app.createTextPlane(el) as DomTextPlane;
      await flush();
      const disposeSpy = vi.spyOn(
        plane.texture as { dispose: () => void },
        "dispose",
      );

      app.removePlane(plane);

      expect(disposeSpy).toHaveBeenCalledTimes(1);
      app.destroy();
    });

    it("ResizeObserver.disconnect が呼ばれる", async () => {
      const app = new DomSyncGL(container);
      const el = makeTextEl();
      const plane = app.createTextPlane(el) as DomTextPlane;
      await flush();

      app.removePlane(plane);

      expect(roDisconnectSpy).toHaveBeenCalledTimes(1);
      app.destroy();
    });

    it("app.destroy() 一括破棄でも texture.dispose と resizeObserver.disconnect が成立する", async () => {
      const app = new DomSyncGL(container);
      const el = makeTextEl();
      const plane = app.createTextPlane(el) as DomTextPlane;
      await flush();
      const disposeSpy = vi.spyOn(
        plane.texture as { dispose: () => void },
        "dispose",
      );

      app.destroy();

      expect(disposeSpy).toHaveBeenCalledTimes(1);
      expect(roDisconnectSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("縮退動作", () => {
    it("getContext が null を返す環境でも生成・tick・destroy が例外なく動く", async () => {
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
      const app = new DomSyncGL(container);
      const el = makeTextEl();

      expect(() => {
        const plane = app.createTextPlane(el) as DomTextPlane;
        app.tick(0);
        app.removePlane(plane);
      }).not.toThrow();

      app.destroy();
    });
  });
});
