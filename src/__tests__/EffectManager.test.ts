import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import type GUI from 'lil-gui';
import { EffectManager } from '../EffectManager';
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

function makeGUI(folder?: Partial<GUI>): GUI {
  return { destroy: vi.fn(), ...folder } as unknown as GUI;
}

describe('EffectManager', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('addEffect: renderer 注入・composer への register・resize が行われる', () => {
    const renderer = makeRenderer();
    const manager = new EffectManager({ renderer, gui: null });
    const effect = new TestEffect();
    // _setRenderer / resize はオプショナルメソッド（未実装だとプロトタイプに存在しない）
    // なので、呼び出しを観測するために自前の fn を生やしてから渡す。
    const setRendererSpy = vi.fn();
    const resizeSpy = vi.fn();
    effect._setRenderer = setRendererSpy;
    effect.resize = resizeSpy;

    const returned = manager.addEffect(effect, 100, 50);

    expect(returned).toBe(effect);
    expect(setRendererSpy).toHaveBeenCalledWith(renderer);
    expect(resizeSpy).toHaveBeenCalledWith(100, 50);
    expect(effect.getPass()).not.toBeNull();
    expect(manager.hasEffects()).toBe(true);
  });

  it('gui が無ければ setupGUI は一切呼ばれない', () => {
    const manager = new EffectManager({ renderer: makeRenderer(), gui: null });
    const effect = new TestEffect();
    effect.setupGUI = vi.fn();

    manager.addEffect(effect, 100, 100);

    expect(effect.setupGUI).not.toHaveBeenCalled();
  });

  it('gui があれば setupGUI(gui) が呼ばれ、戻り値のフォルダが _attachGUI() で登録される', () => {
    const gui = makeGUI();
    const folder = makeGUI();
    const manager = new EffectManager({ renderer: makeRenderer(), gui });
    const effect = new TestEffect();
    effect.setupGUI = vi.fn(() => folder);
    const attachSpy = vi.spyOn(effect, '_attachGUI');

    manager.addEffect(effect, 100, 100);

    expect(effect.setupGUI).toHaveBeenCalledWith(gui);
    expect(attachSpy).toHaveBeenCalledWith(folder);
  });

  it('setupGUI が void を返した場合は _attachGUI が呼ばれない（フォルダ破棄漏れの回帰）', () => {
    const gui = makeGUI();
    const manager = new EffectManager({ renderer: makeRenderer(), gui });
    const effect = new TestEffect();
    effect.setupGUI = vi.fn(() => undefined);
    const attachSpy = vi.spyOn(effect, '_attachGUI');

    manager.addEffect(effect, 100, 100);

    expect(attachSpy).not.toHaveBeenCalled();
  });

  it('removeEffect: setupGUI が返したフォルダが破棄され、effect も dispose される', () => {
    const gui = makeGUI();
    const folder = makeGUI();
    const manager = new EffectManager({ renderer: makeRenderer(), gui });
    const effect = new TestEffect();
    effect.setupGUI = vi.fn(() => folder);
    effect.dispose = vi.fn();

    manager.addEffect(effect, 100, 100);
    const removed = manager.removeEffect(effect);

    expect(removed).toBe(true);
    expect(folder.destroy).toHaveBeenCalledTimes(1);
    expect(effect.dispose).toHaveBeenCalledTimes(1);
    expect(manager.hasEffects()).toBe(false);
  });

  it('removeEffect: 未登録の effect には false を返し何もしない', () => {
    const manager = new EffectManager({ renderer: makeRenderer(), gui: null });
    const effect = new TestEffect();
    expect(manager.removeEffect(effect)).toBe(false);
  });

  it('clearEffects: 全 effect が dispose され、postEffect/internalComposer もリセットされる', () => {
    const manager = new EffectManager({ renderer: makeRenderer(), gui: null });
    const e1 = new TestEffect();
    const e2 = new TestEffect();
    e1.dispose = vi.fn();
    e2.dispose = vi.fn();
    manager.addEffect(e1, 100, 100);
    manager.addEffect(e2, 100, 100);

    manager.clearEffects();

    expect(e1.dispose).toHaveBeenCalledTimes(1);
    expect(e2.dispose).toHaveBeenCalledTimes(1);
    expect(manager.hasEffects()).toBe(false);
  });

  it('dispose: clearEffects と同様に全 effect を破棄する', () => {
    const manager = new EffectManager({ renderer: makeRenderer(), gui: null });
    const effect = new TestEffect();
    effect.dispose = vi.fn();
    manager.addEffect(effect, 100, 100);

    manager.dispose();

    expect(effect.dispose).toHaveBeenCalledTimes(1);
    expect(manager.hasEffects()).toBe(false);
  });

  it('update: enabled=false の effect はスキップされる', () => {
    const manager = new EffectManager({ renderer: makeRenderer(), gui: null });
    const e1 = new TestEffect();
    const e2 = new TestEffect();
    manager.addEffect(e1, 100, 100);
    manager.addEffect(e2, 100, 100);
    e2.enabled = false;
    const spy1 = vi.spyOn(e1, 'update');
    const spy2 = vi.spyOn(e2, 'update');

    const mouse = new THREE.Vector2(0.5, 0.5);
    manager.update(1.5, mouse);

    expect(spy1).toHaveBeenCalledWith(1.5, mouse);
    expect(spy2).not.toHaveBeenCalled();
  });

  it('render: postEffect が無ければ renderer.render に素通しする', () => {
    const renderer = makeRenderer();
    const manager = new EffectManager({ renderer, gui: null });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();

    manager.render(scene, camera);

    expect(renderer.render).toHaveBeenCalledWith(scene, camera);
  });

  it('addEffect: 2 回目以降は同じ内部 EffectComposer を postEffect として再利用する', () => {
    const manager = new EffectManager({ renderer: makeRenderer(), gui: null });
    const e1 = new TestEffect();
    const e2 = new TestEffect();

    manager.addEffect(e1, 100, 100);
    const composerAfterFirst = (
      manager as unknown as { internalComposer: unknown }
    ).internalComposer;

    manager.addEffect(e2, 100, 100);
    const composerAfterSecond = (
      manager as unknown as { internalComposer: unknown }
    ).internalComposer;

    // 内部 composer インスタンスそのものが使い回されている（2つ目で新規生成されていない）
    expect(composerAfterFirst).not.toBeNull();
    expect(composerAfterSecond).toBe(composerAfterFirst);
    expect(e1.getPass()).not.toBeNull();
    expect(e2.getPass()).not.toBeNull();
    expect(manager.hasEffects()).toBe(true);
  });

  it('setPostEffect: 既に addEffect 済みの effect があると DEV は throw、production は warn して差し替える', () => {
    const manager = new EffectManager({ renderer: makeRenderer(), gui: null });
    const effect = new TestEffect();
    manager.addEffect(effect, 100, 100);

    const customPostEffect = {
      render: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
    };

    if (import.meta.env?.DEV) {
      expect(() => manager.setPostEffect(customPostEffect)).toThrow();
    } else {
      expect(() => manager.setPostEffect(customPostEffect)).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
      expect(manager.hasEffects()).toBe(false); // clearEffects() されている
    }
  });
});
