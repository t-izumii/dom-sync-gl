import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { EffectComposer } from '../EffectComposer';
import { BaseEffect, type BaseEffectConfig } from '../effects/BaseEffect';

function makeRenderer(): THREE.WebGPURenderer {
  return {
    getPixelRatio: () => 1,
    setRenderTarget: vi.fn(),
    render: vi.fn(),
  } as unknown as THREE.WebGPURenderer;
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
