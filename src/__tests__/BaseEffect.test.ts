import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform, vec4 } from 'three/tsl';
import type { TextureNode } from 'three/webgpu';
import { EffectComposer } from '../EffectComposer';
import { FeedbackBuffer } from '../FeedbackBuffer';
import {
  BaseEffect,
  type BaseEffectConfig,
  type FeedbackNodeContext,
} from '../effects/BaseEffect';

function makeRenderer(): THREE.WebGPURenderer {
  return {
    getPixelRatio: () => 1,
    setRenderTarget: vi.fn(),
    render: vi.fn(),
  } as unknown as THREE.WebGPURenderer;
}

/**
 * 蓄積バッファのテスト用 renderer モック。
 * 実 GPU 無しで動かすため、RenderTarget の現在値だけを状態として持つ。
 */
function makeFeedbackRenderer(init?: () => Promise<void>) {
  let current: THREE.RenderTarget | null = null;
  const drawingBuffer = new THREE.Vector2(200, 100);
  return {
    drawingBuffer,
    getPixelRatio: () => 1,
    getDrawingBufferSize: vi.fn((t: THREE.Vector2) => t.copy(drawingBuffer)),
    getRenderTarget: vi.fn(() => current),
    setRenderTarget: vi.fn((t: THREE.RenderTarget | null = null) => {
      current = t;
    }),
    render: vi.fn(),
    clear: vi.fn(),
    getClearColor: vi.fn((c: THREE.Color) => c),
    getClearAlpha: vi.fn(() => 1),
    setClearColor: vi.fn(),
    init: vi.fn(init ?? (() => Promise.resolve())),
  };
}

type RendererMock = ReturnType<typeof makeFeedbackRenderer>;

const asRenderer = (m: RendererMock): THREE.WebGPURenderer =>
  m as unknown as THREE.WebGPURenderer;

// _attachRenderer() が張る init() の完了を待つ（マイクロタスク経由で ready になる）
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface FeedbackInternals {
  _fbRead: THREE.RenderTarget | null;
  _fbWrite: THREE.RenderTarget | null;
  _fbMaterial: THREE.MeshBasicNodeMaterial | null;
}

const internals = (effect: BaseEffect): FeedbackInternals =>
  effect as unknown as FeedbackInternals;

class FeedbackEffect extends BaseEffect {
  readonly nodeFactory = vi.fn((ctx: FeedbackNodeContext) =>
    vec4(ctx.prev.rgb.mul(0.95), 1.0),
  );

  constructor(private readonly feedbackSize: 'screen' | number = 'screen') {
    super();
  }

  get fbTexture(): TextureNode {
    return this.feedbackTexture;
  }

  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: (ctx) =>
        vec4(ctx.inputTexture.rgb.add(this.feedbackTexture.rgb), 1.0),
      feedback: {
        size: this.feedbackSize,
        node: this.nodeFactory,
      },
    };
  }
}

class TestEffect extends BaseEffect {
  protected getConfig(): BaseEffectConfig {
    // 前段の出力をそのまま返す素通しエフェクト（旧 passthrough fragmentShader 相当）
    return {
      outputNode: (ctx) => ctx.inputTexture,
      uniforms: { uTime: uniform(0) },
    };
  }
}

function makeGUI(): { destroy: ReturnType<typeof vi.fn> } {
  return { destroy: vi.fn() };
}

// protected な共通実行時状態をアサートするためだけの公開窓口
class StateEffect extends TestEffect {
  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }
  get time(): number {
    return this.uTime.value;
  }
  get mouse(): THREE.Vector2 {
    return this.uMouse.value;
  }
  get move(): number {
    return this.uMove.value;
  }
  get gate(): { threshold: number; scale: number; release: number } {
    const { threshold, scale, release } = this.mouseMotion;
    return { threshold, scale, release };
  }
  get prevMouse(): THREE.Vector2 {
    return this.uPrevMouse.value;
  }
  get motionPrev(): THREE.Vector2 {
    return this.mouseMotion.prev;
  }
  get fbTexture(): TextureNode {
    return this.feedbackTexture;
  }
}

describe('BaseEffect._register()', () => {
  it('初回 register では pass が作られる', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    const effect = new TestEffect();

    effect._register(composer);

    expect(effect.getPass()).not.toBeNull();
    composer.dispose();
  });

  it('同じ target への 2 回目の register は throw する（単一 owner・使い捨て契約）', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    const effect = new TestEffect();

    effect._register(composer);
    const pass = effect.getPass()!;

    expect(() => effect._register(composer)).toThrow(/already registered to another owner/);
    // 旧 pass はそのまま保持され、副作用で差し替わっていない
    expect(effect.getPass()).toBe(pass);
    composer.dispose();
  });

  it('別 target への re-register も throw する（owner をまたいだ二重登録の禁止）', () => {
    const composerA = new EffectComposer(makeRenderer(), 100, 100);
    const composerB = new EffectComposer(makeRenderer(), 100, 100);
    const effect = new TestEffect();

    effect._register(composerA);

    expect(() => effect._register(composerB)).toThrow(/already registered to another owner/);
    composerA.dispose();
    composerB.dispose();
  });

  it('dispose 済みの effect を register しようとすると throw する', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    const effect = new TestEffect();
    effect._register(composer);
    composer.removeEffect(effect.getPass()!);
    effect._dispose();

    expect(() => effect._register(composer)).toThrow(/disposed effect cannot be registered/);
    composer.dispose();
  });
});

describe('BaseEffect._attachGUI() / _dispose()', () => {
  it('_dispose() 後の _attachGUI() は、保持せず即座に渡されたフォルダを破棄する（FeedbackBuffer._attachGUI() と対称）', () => {
    const effect = new TestEffect();
    effect._dispose();

    const lateFolder = makeGUI();
    effect._attachGUI(lateFolder as unknown as Parameters<TestEffect['_attachGUI']>[0]);

    expect(lateFolder.destroy).toHaveBeenCalledTimes(1);
  });

  it('_dispose() は冪等（2 回呼んでも GUI フォルダの破棄は 1 回だけ）', () => {
    const effect = new TestEffect();
    const folder = makeGUI();
    effect._attachGUI(folder as unknown as Parameters<TestEffect['_attachGUI']>[0]);

    effect._dispose();
    effect._dispose();

    expect(folder.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('BaseEffect._setSize() / _setFrameState()', () => {
  it('初期値は width/height = 1、uTime = 0、uMouse = (0.5, 0.5)', () => {
    const effect = new StateEffect();

    expect(effect.size).toEqual({ width: 1, height: 1 });
    expect(effect.time).toBe(0);
    expect(effect.mouse.x).toBe(0.5);
    expect(effect.mouse.y).toBe(0.5);
  });

  it('_setSize() が width/height を更新する', () => {
    const effect = new StateEffect();

    effect._setSize(320, 180);

    expect(effect.size).toEqual({ width: 320, height: 180 });
  });

  it('_setFrameState() が uTime.value と uMouse.value を更新する', () => {
    const effect = new StateEffect();

    effect._setFrameState(1.25, new THREE.Vector2(0.2, 0.8));

    expect(effect.time).toBe(1.25);
    expect(effect.mouse.x).toBeCloseTo(0.2);
    expect(effect.mouse.y).toBeCloseTo(0.8);
  });

  it('mouse 未指定の _setFrameState() は uMouse を前回値のまま保持する', () => {
    const effect = new StateEffect();
    effect._setFrameState(0, new THREE.Vector2(0.2, 0.8));

    effect._setFrameState(2);

    expect(effect.time).toBe(2);
    expect(effect.mouse.x).toBeCloseTo(0.2);
    expect(effect.mouse.y).toBeCloseTo(0.8);
  });

  it('uMouse は同じ Vector2 インスタンスを使い回す（参照差し替えではなく copy）', () => {
    const effect = new StateEffect();
    const before = effect.mouse;
    const shared = new THREE.Vector2(0.1, 0.9);

    effect._setFrameState(0, shared);
    // 呼び出し元が渡した Vector2 を使い回して書き換えても effect 側は影響を受けない
    shared.set(0.7, 0.3);

    expect(effect.mouse).toBe(before);
    expect(effect.mouse).not.toBe(shared);
    expect(effect.mouse.x).toBeCloseTo(0.1);
    expect(effect.mouse.y).toBeCloseTo(0.9);
  });
});

describe('BaseEffect uMove（マウス移動強度ゲート）', () => {
  const at = (x: number, y = 0.5): THREE.Vector2 => new THREE.Vector2(x, y);

  it('初期値は 0', () => {
    const effect = new StateEffect();

    expect(effect.move).toBe(0);
  });

  it('既定のノブは FeedbackBuffer と同じ', () => {
    const effect = new StateEffect();

    expect(effect.gate).toEqual({
      threshold: 0.0008,
      scale: 0.01,
      release: 0.85,
    });
  });

  it('前回位置が無い初回は 0 のまま', () => {
    const effect = new StateEffect();

    effect._setFrameState(0, at(0.5));

    expect(effect.move).toBe(0);
  });

  it('threshold 以下の微小な移動では 0', () => {
    const effect = new StateEffect();
    effect._setFrameState(0, at(0.5));

    effect._setFrameState(1, at(0.5005));

    expect(effect.move).toBe(0);
  });

  it('十分な移動で 0 より大きくなる', () => {
    const effect = new StateEffect();
    effect._setFrameState(0, at(0.5));

    effect._setFrameState(1, at(0.505));

    expect(effect.move).toBeCloseTo(0.5);
  });

  it('テレポート相当の巨大な移動でも 1 で頭打ち', () => {
    const effect = new StateEffect();
    effect._setFrameState(0, at(0.0, 0.0));

    effect._setFrameState(1, at(1.0, 1.0));

    expect(effect.move).toBe(1);
    expect(effect.move).toBeLessThanOrEqual(1);
  });

  it('移動を止めると release 倍ずつ単調に減衰する', () => {
    const effect = new StateEffect();
    effect._setFrameState(0, at(0.5));
    effect._setFrameState(1, at(0.505));
    const peak = effect.move;

    const decayed: number[] = [];
    for (let i = 0; i < 3; i++) {
      effect._setFrameState(2 + i, at(0.505));
      decayed.push(effect.move);
    }

    expect(decayed[0]).toBeCloseTo(peak * 0.85);
    expect(decayed[1]).toBeCloseTo(peak * 0.85 ** 2);
    expect(decayed[2]).toBeCloseTo(peak * 0.85 ** 3);
    expect(decayed[1]).toBeLessThan(decayed[0]);
    expect(decayed[2]).toBeLessThan(decayed[1]);
  });

  it('動き出しは減衰を待たず即座に立ち上がる', () => {
    const effect = new StateEffect();
    effect._setFrameState(0, at(0.5));
    effect._setFrameState(1, at(0.501));
    const small = effect.move;
    expect(small).toBeCloseTo(0.1);

    effect._setFrameState(2, at(0.506));

    expect(effect.move).toBeCloseTo(0.5);
    expect(effect.move).toBeGreaterThan(small * 0.85);
  });

  it('mouse 未指定でも減衰は進む', () => {
    const effect = new StateEffect();
    effect._setFrameState(0, at(0.5));
    effect._setFrameState(1, at(0.505));
    const peak = effect.move;

    effect._setFrameState(2);

    expect(effect.move).toBeCloseTo(peak * 0.85);
  });

  // ロジックの正本は FeedbackBuffer 側。式を写経した独自実装ではなく実物と突き合わせ、
  // 正本が変わったときに post effect 側の乖離が検出されるようにする。
  it('FeedbackBuffer.step() の uMove と数値的に完全一致する', () => {
    const mock = makeFeedbackRenderer();
    const buffer = new FeedbackBuffer(asRenderer(mock), {
      outputNode: ({ uPrev }) => uPrev,
    });
    const effect = new StateEffect();
    effect._setSize(1920, 1080);
    const aspect = 1920 / 1080;

    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    const m = new THREE.Vector2(0.5, 0.5);
    for (let i = 0; i < 500; i++) {
      // 静止・threshold 未満の微動・通常移動・テレポートを混ぜる
      const r = rnd();
      if (r < 0.5) {
        const span = r < 0.25 ? 0 : 0.0004;
        m.set(m.x + (rnd() - 0.5) * span, m.y + (rnd() - 0.5) * span);
      } else if (r < 0.9) {
        m.set(m.x + (rnd() - 0.5) * 0.02, m.y + (rnd() - 0.5) * 0.02);
      } else {
        m.set(rnd(), rnd());
      }

      effect._setFrameState(i / 60, m);
      buffer.step({ mouse: m, hover: 0, time: i / 60, aspect });

      expect(effect.move).toBe(buffer.uniforms.uMove.value);
    }

    buffer.dispose();
  });

  it('uPrevMouse は前フレームのマウス位置を指す', () => {
    const effect = new StateEffect();

    effect._setFrameState(0, at(0.2, 0.3));
    // 初回は現在位置と同値（差分が自然に 0 になる）
    expect(effect.prevMouse.x).toBeCloseTo(0.2);
    expect(effect.prevMouse.y).toBeCloseTo(0.3);

    effect._setFrameState(1, at(0.8, 0.9));

    expect(effect.prevMouse.x).toBeCloseTo(0.2);
    expect(effect.prevMouse.y).toBeCloseTo(0.3);
    expect(effect.mouse.x).toBeCloseTo(0.8);
  });

  it('mouse 未指定のフレームでは uPrevMouse を動かさない', () => {
    const effect = new StateEffect();
    effect._setFrameState(0, at(0.2));
    effect._setFrameState(1, at(0.8));

    effect._setFrameState(2);

    expect(effect.prevMouse.x).toBeCloseTo(0.2);
  });

  it('mouseMotion.prev から JS 側でも前フレーム位置を読める', () => {
    const effect = new StateEffect();
    effect._setFrameState(0, at(0.2));
    effect._setFrameState(1, at(0.8));

    expect(effect.motionPrev.x).toBeCloseTo(0.2);
  });

  it('アスペクト比が反映される（横長ほど同じ dx で move が大きい）', () => {
    const square = new StateEffect();
    square._setSize(100, 100);
    square._setFrameState(0, at(0.5));
    square._setFrameState(1, at(0.502));

    const wide = new StateEffect();
    wide._setSize(200, 100);
    wide._setFrameState(0, at(0.5));
    wide._setFrameState(1, at(0.502));

    expect(square.move).toBeCloseTo(0.2);
    expect(wide.move).toBeCloseTo(0.4);
    expect(wide.move).toBeGreaterThan(square.move);
  });
});

describe('BaseEffect feedback バッファ', () => {
  it('plane owner は renderer 全体でなく plane の寸法と DPR で確保する', () => {
    const mock = makeFeedbackRenderer();
    mock.getPixelRatio = () => 2;
    mock.drawingBuffer.set(3840, 2160);
    const effect = new FeedbackEffect();
    effect._setSize(200, 100);
    effect._attachRenderer(asRenderer(mock), true);
    const composer = new EffectComposer(asRenderer(mock), 200, 100);
    effect._register(composer);
    const image = effect.fbTexture.value.image as { width: number; height: number };
    expect(image.width).toBe(400);
    expect(image.height).toBe(200);
    expect(mock.getDrawingBufferSize).not.toHaveBeenCalled();
    effect._dispose(); composer.dispose();
  });
  it('feedback 未宣言なら RT を確保せず、_renderFeedback() は no-op', async () => {
    const mock = makeFeedbackRenderer();
    const composer = new EffectComposer(asRenderer(mock), 100, 100);
    const effect = new StateEffect();

    effect._attachRenderer(asRenderer(mock));
    effect._register(composer);
    effect._setSize(100, 100);
    await flush();
    mock.setRenderTarget.mockClear();
    mock.render.mockClear();

    effect._renderFeedback();

    expect(internals(effect)._fbRead).toBeNull();
    expect(internals(effect)._fbWrite).toBeNull();
    expect(mock.setRenderTarget).not.toHaveBeenCalled();
    expect(mock.render).not.toHaveBeenCalled();
    // 1x1 の透明プレースホルダを指したまま
    const placeholder = effect.fbTexture.value as { image: { width: number } };
    expect(placeholder.image.width).toBe(1);
    composer.dispose();
  });

  it('feedback.node は register 時に一度だけ呼ばれる', async () => {
    const mock = makeFeedbackRenderer();
    const composer = new EffectComposer(asRenderer(mock), 100, 100);
    const effect = new FeedbackEffect();

    effect._attachRenderer(asRenderer(mock));
    effect._register(composer);
    expect(effect.nodeFactory).toHaveBeenCalledTimes(1);

    await flush();
    effect._setSize(100, 100);
    effect._renderFeedback();
    effect._renderFeedback();

    expect(effect.nodeFactory).toHaveBeenCalledTimes(1);
    effect._dispose();
    composer.dispose();
  });

  it('_renderFeedback() は呼び出し前の RenderTarget を復元する', async () => {
    const mock = makeFeedbackRenderer();
    const composer = new EffectComposer(asRenderer(mock), 100, 100);
    const effect = new FeedbackEffect();
    effect._attachRenderer(asRenderer(mock));
    effect._register(composer);
    await flush();

    const outer = new THREE.RenderTarget(4, 4);
    mock.setRenderTarget(outer);

    effect._renderFeedback();

    expect(mock.getRenderTarget()).toBe(outer);
    expect(mock.render).toHaveBeenCalled();
    outer.dispose();
    effect._dispose();
    composer.dispose();
  });

  it('_renderFeedback() で read/write が swap され feedbackTexture.value が更新される', async () => {
    const mock = makeFeedbackRenderer();
    const composer = new EffectComposer(asRenderer(mock), 100, 100);
    const effect = new FeedbackEffect();
    effect._attachRenderer(asRenderer(mock));
    effect._register(composer);
    await flush();

    const first = internals(effect)._fbRead;
    const second = internals(effect)._fbWrite;
    expect(effect.fbTexture.value).toBe(first!.texture);

    effect._renderFeedback();

    expect(internals(effect)._fbRead).toBe(second);
    expect(internals(effect)._fbWrite).toBe(first);
    expect(effect.fbTexture.value).toBe(second!.texture);

    effect._renderFeedback();

    expect(internals(effect)._fbRead).toBe(first);
    expect(effect.fbTexture.value).toBe(first!.texture);
    effect._dispose();
    composer.dispose();
  });

  it('renderer.init() 未完了の間は GPU コマンドを発行しない', async () => {
    let resolveInit: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      resolveInit = resolve;
    });
    const mock = makeFeedbackRenderer(() => ready);
    const composer = new EffectComposer(asRenderer(mock), 100, 100);
    const effect = new FeedbackEffect();
    effect._attachRenderer(asRenderer(mock));
    effect._register(composer);
    mock.setRenderTarget.mockClear();

    effect._renderFeedback();

    expect(mock.render).not.toHaveBeenCalled();
    expect(mock.clear).not.toHaveBeenCalled();
    expect(mock.setRenderTarget).not.toHaveBeenCalled();

    resolveInit();
    await flush();
    effect._renderFeedback();

    expect(mock.render).toHaveBeenCalledTimes(1);
    // 初回のみ read/write を 0 クリアする
    expect(mock.clear).toHaveBeenCalledTimes(2);
    effect._dispose();
    composer.dispose();
  });

  it("size: 'screen' はサイズが実際に変わったときだけ RT を作り直す", async () => {
    const mock = makeFeedbackRenderer();
    const composer = new EffectComposer(asRenderer(mock), 100, 100);
    const effect = new FeedbackEffect();
    effect._attachRenderer(asRenderer(mock));
    effect._register(composer);
    await flush();

    const before = internals(effect)._fbRead;
    effect._setSize(200, 100);
    expect(internals(effect)._fbRead).toBe(before);

    mock.drawingBuffer.set(320, 240);
    effect._setSize(320, 240);

    expect(internals(effect)._fbRead).not.toBe(before);
    effect._dispose();
    composer.dispose();
  });

  it('size が数値ならリサイズでは作り直さない', async () => {
    const mock = makeFeedbackRenderer();
    const composer = new EffectComposer(asRenderer(mock), 100, 100);
    const effect = new FeedbackEffect(64);
    effect._attachRenderer(asRenderer(mock));
    effect._register(composer);
    await flush();

    const before = internals(effect)._fbRead;
    expect(before!.width).toBe(64);
    expect(before!.height).toBe(64);

    mock.drawingBuffer.set(320, 240);
    effect._setSize(320, 240);

    expect(internals(effect)._fbRead).toBe(before);
    effect._dispose();
    composer.dispose();
  });

  it('_dispose() で RT ペアと feedback material が dispose される', async () => {
    const mock = makeFeedbackRenderer();
    const composer = new EffectComposer(asRenderer(mock), 100, 100);
    const effect = new FeedbackEffect();
    effect._attachRenderer(asRenderer(mock));
    effect._register(composer);
    await flush();

    const readSpy = vi.spyOn(internals(effect)._fbRead!, 'dispose');
    const writeSpy = vi.spyOn(internals(effect)._fbWrite!, 'dispose');
    const materialSpy = vi.spyOn(internals(effect)._fbMaterial!, 'dispose');

    effect._dispose();

    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(materialSpy).toHaveBeenCalledTimes(1);
    expect(internals(effect)._fbRead).toBeNull();
    expect(internals(effect)._fbWrite).toBeNull();
    expect(internals(effect)._fbMaterial).toBeNull();

    mock.render.mockClear();
    effect._renderFeedback();
    expect(mock.render).not.toHaveBeenCalled();
    composer.dispose();
  });
});
