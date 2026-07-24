import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { EffectComposer } from '../EffectComposer';
import { BaseEffect, type BaseEffectConfig } from '../effects/BaseEffect';

function makeRenderer(): THREE.WebGLRenderer {
  return {
    getPixelRatio: () => 1,
    setRenderTarget: vi.fn(),
    render: vi.fn(),
  } as unknown as THREE.WebGLRenderer;
}

class TestEffect extends BaseEffect {
  protected getConfig(): BaseEffectConfig {
    return {
      fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
      uniforms: { uTime: { value: 0 } },
    };
  }
}

function makeGUI(): { destroy: ReturnType<typeof vi.fn> } {
  return { destroy: vi.fn() };
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
