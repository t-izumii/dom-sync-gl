import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform, vec4 } from 'three/tsl';
import type { TextureNode } from 'three/webgpu';
import { EffectComposer } from '../EffectComposer';
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

    expect(() => effect._register(composer)).toThrow(/既に別の owner に登録済み/);
    // 旧 pass はそのまま保持され、副作用で差し替わっていない
    expect(effect.getPass()).toBe(pass);
    composer.dispose();
  });

  it('別 target への re-register も throw する（owner をまたいだ二重登録の禁止）', () => {
    const composerA = new EffectComposer(makeRenderer(), 100, 100);
    const composerB = new EffectComposer(makeRenderer(), 100, 100);
    const effect = new TestEffect();

    effect._register(composerA);

    expect(() => effect._register(composerB)).toThrow(/既に別の owner に登録済み/);
    composerA.dispose();
    composerB.dispose();
  });

  it('dispose 済みの effect を register しようとすると throw する', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    const effect = new TestEffect();
    effect._register(composer);
    composer.removeEffect(effect.getPass()!);
    effect._dispose();

    expect(() => effect._register(composer)).toThrow(/dispose 済み/);
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

describe('BaseEffect feedback バッファ', () => {
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
