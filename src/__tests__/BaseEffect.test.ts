import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

class ThrowsOnSecondGetConfig extends BaseEffect {
  private calls = 0;
  protected getConfig(): BaseEffectConfig {
    this.calls++;
    if (this.calls === 2) throw new Error('boom');
    return { fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }' };
  }
}

function makeGUI(): { destroy: ReturnType<typeof vi.fn> } {
  return { destroy: vi.fn() };
}

describe('BaseEffect._register()', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('初回 register では警告なく pass が作られる', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    const effect = new TestEffect();

    effect._register(composer);

    expect(effect.getPass()).not.toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
    composer.dispose();
  });

  it('同じ target への 2 回目の register は旧 pass を dispose してから新しい pass に差し替える（回収不能の回帰）', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    const effect = new TestEffect();

    effect._register(composer);
    const oldPass = effect.getPass()!;
    const oldMaterialDisposeSpy = vi.spyOn(oldPass.material, 'dispose');

    effect._register(composer);
    const newPass = effect.getPass()!;

    expect(newPass).not.toBe(oldPass);
    expect(oldMaterialDisposeSpy).toHaveBeenCalledTimes(1);
    // 旧 pass は EffectComposer 側の passes 配列からも取り除かれている
    // （残っていると removeEffect が true を返すはずなので false で確認）
    expect(composer.removeEffect(oldPass)).toBe(false);
    composer.dispose();
  });

  it('別 target への re-register でも旧 target 側の pass を dispose する', () => {
    const composerA = new EffectComposer(makeRenderer(), 100, 100);
    const composerB = new EffectComposer(makeRenderer(), 100, 100);
    const effect = new TestEffect();

    effect._register(composerA);
    const oldPass = effect.getPass()!;
    const oldMaterialDisposeSpy = vi.spyOn(oldPass.material, 'dispose');

    effect._register(composerB);

    expect(oldMaterialDisposeSpy).toHaveBeenCalledTimes(1);
    expect(composerA.removeEffect(oldPass)).toBe(false); // 既に除去済み
    composerA.dispose();
    composerB.dispose();
  });

  it('re-register 後も enabled の状態が新しい pass に引き継がれる', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    const effect = new TestEffect();
    effect._register(composer);
    effect.enabled = false;

    effect._register(composer);

    expect(effect.getPass()!.enabled).toBe(false);
    composer.dispose();
  });

  it('getConfig() が例外を投げても旧 pass は破棄されず、getPass() は旧 pass を返し続ける', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    const effect = new ThrowsOnSecondGetConfig();
    effect._register(composer);
    const pass = effect.getPass()!;
    const disposeSpy = vi.spyOn(pass.material, 'dispose');

    expect(() => effect._register(composer)).toThrow('boom');

    expect(disposeSpy).not.toHaveBeenCalled();
    expect(effect.getPass()).toBe(pass);
    expect(composer.removeEffect(pass)).toBe(true); // まだ composer に登録されたまま
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
