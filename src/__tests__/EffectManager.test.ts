import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import type GUI from 'lil-gui';
import { EffectManager } from '../EffectManager';
import { BaseEffect, type BaseEffectConfig } from '../effects/BaseEffect';

function makeRenderer(maxSamples = 0): THREE.WebGPURenderer {
  let current: THREE.RenderTarget | null = null;
  return {
    getPixelRatio: () => 1,
    getRenderTarget: vi.fn(() => current),
    setRenderTarget: vi.fn((t: THREE.RenderTarget | null = null) => {
      current = t;
    }),
    render: vi.fn(),
    capabilities: { maxSamples },
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

    manager.render(scene, camera, null);

    expect(renderer.render).toHaveBeenCalledWith(scene, camera);
  });

  it('render: postEffect が無ければ最終出力を outputTarget へ向ける（CR-05）', () => {
    const renderer = makeRenderer();
    const manager = new EffectManager({ renderer, gui: null });
    const rt = {} as THREE.RenderTarget;

    manager.render(new THREE.Scene(), new THREE.PerspectiveCamera(), rt);

    expect(renderer.setRenderTarget).toHaveBeenCalledWith(rt);
  });

  it('render: postEffect 無しで外部 RT をバインド中でも呼び出し後に復元する（CR-05）', () => {
    const renderer = makeRenderer();
    const manager = new EffectManager({ renderer, gui: null });
    const ext = {} as THREE.RenderTarget;
    renderer.setRenderTarget(ext);

    manager.render(new THREE.Scene(), new THREE.PerspectiveCamera(), null);

    expect(renderer.getRenderTarget()).toBe(ext);
  });

  it('render: postEffect 有りなら outputTarget を委譲する（CR-05）', () => {
    const renderer = makeRenderer();
    const manager = new EffectManager({ renderer, gui: null });
    const postEffect = { render: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
    manager.setPostEffect(postEffect);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const rt = {} as THREE.RenderTarget;

    manager.render(scene, camera, rt);

    expect(postEffect.render).toHaveBeenCalledWith(scene, camera, rt);
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

  it('同じ effect を同じ manager に 2 回 addEffect すると throw する（単一 owner・使い捨て契約）', () => {
    const manager = new EffectManager({ renderer: makeRenderer(), gui: null });
    const effect = new TestEffect();

    manager.addEffect(effect, 100, 100);

    expect(() => manager.addEffect(effect, 100, 100)).toThrow(/既に別の owner に登録済み/);
  });

  it('別の manager にまたがる二重登録も throw する', () => {
    const managerA = new EffectManager({ renderer: makeRenderer(), gui: null });
    const managerB = new EffectManager({ renderer: makeRenderer(), gui: null });
    const effect = new TestEffect();

    managerA.addEffect(effect, 100, 100);

    expect(() => managerB.addEffect(effect, 100, 100)).toThrow(/既に別の owner に登録済み/);
  });

  it('removeEffect で dispose 済みの effect は再 addEffect できず throw する', () => {
    const manager = new EffectManager({ renderer: makeRenderer(), gui: null });
    const effect = new TestEffect();

    manager.addEffect(effect, 100, 100);
    manager.removeEffect(effect);

    expect(() => manager.addEffect(effect, 100, 100)).toThrow(/dispose 済み/);
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

  it('setPostEffect(A) → setPostEffect(B) で所有する A が dispose される（CR-12）', () => {
    const manager = new EffectManager({ renderer: makeRenderer(), gui: null });
    const a = { render: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
    const b = { render: vi.fn(), resize: vi.fn(), dispose: vi.fn() };

    manager.setPostEffect(a);
    manager.setPostEffect(b);

    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(b.dispose).not.toHaveBeenCalled();
  });

  it('setPostEffect(A, { owned: false }) の A は置き換え時に dispose されない（CR-12）', () => {
    const manager = new EffectManager({ renderer: makeRenderer(), gui: null });
    const a = { render: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
    const b = { render: vi.fn(), resize: vi.fn(), dispose: vi.fn() };

    manager.setPostEffect(a, undefined, undefined, { owned: false });
    manager.setPostEffect(b);

    expect(a.dispose).not.toHaveBeenCalled();
  });

  it('setPostEffect(A, { owned: false }) の A は clearEffects/dispose でも dispose されない（CR-12）', () => {
    const manager = new EffectManager({ renderer: makeRenderer(), gui: null });
    const a = { render: vi.fn(), resize: vi.fn(), dispose: vi.fn() };

    manager.setPostEffect(a, undefined, undefined, { owned: false });
    manager.clearEffects();
    manager.dispose();

    expect(a.dispose).not.toHaveBeenCalled();
  });

  it('setPostEffect: サイズを渡すと設定直後に現在サイズで resize される（CR-12）', () => {
    const manager = new EffectManager({ renderer: makeRenderer(), gui: null });
    const pe = { render: vi.fn(), resize: vi.fn(), dispose: vi.fn() };

    manager.setPostEffect(pe, 800, 600);

    expect(pe.resize).toHaveBeenCalledWith(800, 600);
  });

  it('setPostEffect: サイズ未指定でも直近の viewport サイズで resize される（CR-12）', () => {
    const manager = new EffectManager({ renderer: makeRenderer(), gui: null });
    manager.resize(400, 300);
    const pe = { render: vi.fn(), resize: vi.fn(), dispose: vi.fn() };

    manager.setPostEffect(pe);

    expect(pe.resize).toHaveBeenCalledWith(400, 300);
  });

  it('removeEffect: 最後の 1 個を外すと internalComposer が dispose され再 addEffect で再生成される（CR-12）', () => {
    const manager = new EffectManager({ renderer: makeRenderer(), gui: null });
    const e1 = new TestEffect();
    manager.addEffect(e1, 100, 100);
    const composer = (
      manager as unknown as { internalComposer: { dispose: () => void } | null }
    ).internalComposer;
    const disposeSpy = vi.spyOn(composer!, 'dispose');

    manager.removeEffect(e1);

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(
      (manager as unknown as { internalComposer: unknown }).internalComposer,
    ).toBeNull();
    expect(manager.hasEffects()).toBe(false);

    // 次の addEffect で新しい internalComposer が生成される
    const e2 = new TestEffect();
    manager.addEffect(e2, 100, 100);
    const recreated = (
      manager as unknown as { internalComposer: unknown }
    ).internalComposer;
    expect(recreated).not.toBeNull();
    expect(recreated).not.toBe(composer);
  });

  it('effectSamples は internalComposer の sceneTarget へ配線される（CR-17）', () => {
    const manager = new EffectManager({
      renderer: makeRenderer(4),
      gui: null,
      effectSamples: 4,
    });
    manager.addEffect(new TestEffect(), 100, 100);

    const composer = (
      manager as unknown as {
        internalComposer: { sceneTarget: { samples: number } | null };
      }
    ).internalComposer;
    expect(composer.sceneTarget).not.toBeNull();
    expect(composer.sceneTarget!.samples).toBe(4);
  });
});
