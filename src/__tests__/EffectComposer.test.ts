import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three/webgpu';
import { texture, uniform } from 'three/tsl';
import { EffectComposer, EffectPass } from '../EffectComposer';
import type { EffectContext } from '../EffectComposer';

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

// 前段の出力をそのまま返す素通しエフェクト（旧 passthrough fragmentShader 相当）
const passthrough = (ctx: EffectContext) => ctx.inputTexture;

// EffectPass 単体テスト用のヘルパー。composer を介さず直接構築する。
function makePass() {
  const uTime = uniform(0);
  const uStrength = uniform(0.5);
  const inputTexture = texture(new THREE.Texture());
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = inputTexture;
  return {
    pass: new EffectPass(material, inputTexture, { uTime, uStrength }),
    uTime,
    uStrength,
  };
}

describe('EffectComposer', () => {
  it('addEffect は EffectPass を返し passes に追加される', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    const pass = composer.addEffect({
      outputNode: passthrough,
      uniforms: { uTime: uniform(0) },
    });
    expect(pass).toBeInstanceOf(EffectPass);
    composer.dispose();
  });

  it('addEffect: inputTexture は targetA を初期値に持ち、ユーザー uniforms は pass から参照できる', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    const uTime = uniform(7);
    const uStrength = uniform(0.3);
    const pass = composer.addEffect({
      outputNode: passthrough,
      uniforms: { uTime, uStrength },
    });

    const targetA = (composer as unknown as { targetA: THREE.RenderTarget })
      .targetA;
    expect(pass.inputTexture.value).toBe(targetA.texture);
    expect(pass.getUniform('uTime')).toBe(uTime);
    expect(pass.getUniform('uTime')?.value).toBe(7);
    expect(pass.getUniform('uStrength')?.value).toBe(0.3);
    composer.dispose();
  });

  it('addEffect: outputNode ファクトリには inputTexture と uv の ctx が一度だけ渡される', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    const outputNode = vi.fn(passthrough);

    const pass = composer.addEffect({ outputNode });

    expect(outputNode).toHaveBeenCalledTimes(1);
    const ctx = outputNode.mock.calls[0][0];
    expect(ctx.inputTexture).toBe(pass.inputTexture);
    expect(ctx.uv).toBeDefined();
    // 返したノードが material の colorNode に配線される
    expect(pass.material.colorNode).toBe(pass.inputTexture);
    composer.dispose();
  });

  it('addEffect の material は premultiplied 契約に沿った素通し設定になる（CR-03）', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    const pass = composer.addEffect({ outputNode: passthrough });

    // 前段の premultiplied な結果を丸ごと置き換えるだけで blend しない。
    expect(pass.material.blending).toBe(THREE.NoBlending);
    expect(pass.material.transparent).toBe(false);
    expect(pass.material.depthTest).toBe(false);
    expect(pass.material.depthWrite).toBe(false);
    composer.dispose();
  });

  it('render: pass が 0 個ならフォールバック描画（setRenderTarget(null) + render を 1 回）', () => {
    const renderer = makeRenderer();
    const composer = new EffectComposer(renderer, 100, 100);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    composer.render(scene, camera);

    expect(renderer.setRenderTarget).toHaveBeenCalledWith(null);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.render).toHaveBeenCalledWith(scene, camera);
    composer.dispose();
  });

  it('render: pass が 1 個なら scene→targetA→canvas の 2 パス描画', () => {
    const renderer = makeRenderer();
    const composer = new EffectComposer(renderer, 100, 100);
    composer.addEffect({ outputNode: passthrough });

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    composer.render(scene, camera);

    // scene を targetA に → 最終パスを outputTarget(null) に → 直前の RT(null) を復元
    expect(renderer.setRenderTarget).toHaveBeenCalledTimes(3);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    // 復元前の最終出力先は null（キャンバスへ出力）
    const calls = (renderer.setRenderTarget as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[calls.length - 2][0]).toBeNull();
    composer.dispose();
  });

  it('render: ping-pong で各 pass の inputTexture.value が読み取り元 RT に差し替わる', () => {
    const renderer = makeRenderer();
    const composer = new EffectComposer(renderer, 100, 100);
    const p1 = composer.addEffect({ outputNode: passthrough });
    const p2 = composer.addEffect({ outputNode: passthrough });
    const internals = composer as unknown as {
      targetA: THREE.RenderTarget;
      targetB: THREE.RenderTarget;
    };

    composer.render(new THREE.Scene(), new THREE.PerspectiveCamera());

    // sceneTarget 無し: scene→targetA。p1 は targetA を読み targetB へ書き、
    // p2（最終）は targetB を読んで outputTarget へ書く。
    expect(p1.inputTexture.value).toBe(internals.targetA.texture);
    expect(p2.inputTexture.value).toBe(internals.targetB.texture);
    composer.dispose();
  });

  it('dispose 後に passes が空になる', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    composer.addEffect({ outputNode: passthrough });
    composer.addEffect({ outputNode: passthrough });
    composer.dispose();

    // passes は private だが、dispose 後は render が pass=0 のパスを通ること
    const renderer = makeRenderer();
    const newComposer = new EffectComposer(renderer, 100, 100);
    newComposer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    // pass=0 ならフォールバック路で1回のみ
    expect(renderer.render).toHaveBeenCalledTimes(1);
    newComposer.dispose();
  });

  it('dispose: 各 pass の material が dispose される', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    const p1 = composer.addEffect({ outputNode: passthrough });
    const p2 = composer.addEffect({ outputNode: passthrough });
    const spy1 = vi.spyOn(p1.material, 'dispose');
    const spy2 = vi.spyOn(p2.material, 'dispose');

    composer.dispose();

    expect(spy1).toHaveBeenCalledTimes(1);
    expect(spy2).toHaveBeenCalledTimes(1);
  });

  it('resize で内部 RenderTarget の解像度が更新される', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    // 内部 targetA / targetB は private なので、resize が例外なく通ることを確認
    expect(() => composer.resize(200, 150)).not.toThrow();
    composer.dispose();
  });

  it('render: disabled の pass は丸ごとスキップされる', () => {
    const renderer = makeRenderer();
    const composer = new EffectComposer(renderer, 100, 100);
    const p1 = composer.addEffect({ outputNode: passthrough });
    composer.addEffect({ outputNode: passthrough });
    p1.enabled = false;

    composer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    // active pass は 1 個なので、scene→targetA + 最終パス の 2 回 render
    expect(renderer.render).toHaveBeenCalledTimes(2);
    composer.dispose();
  });

  it('render: 全 pass を disabled にするとフォールバック路 (1 回 render)', () => {
    const renderer = makeRenderer();
    const composer = new EffectComposer(renderer, 100, 100);
    const p1 = composer.addEffect({ outputNode: passthrough });
    const p2 = composer.addEffect({ outputNode: passthrough });
    p1.enabled = false;
    p2.enabled = false;

    composer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.setRenderTarget).toHaveBeenCalledWith(null);
    composer.dispose();
  });

  it('removeEffect: 該当 pass を取り除いて material を dispose する', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    const p1 = composer.addEffect({ outputNode: passthrough });
    const disposeSpy = vi.spyOn(p1.material, 'dispose');

    const removed = composer.removeEffect(p1);
    expect(removed).toBe(true);
    expect(disposeSpy).toHaveBeenCalled();
    composer.dispose();
  });

  it('removeEffect: 未登録の pass を渡すと false を返して何もしない', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    const { pass: stranger } = makePass();
    expect(composer.removeEffect(stranger)).toBe(false);
    composer.dispose();
  });

  it('removeEffect 後に残った pass だけが render される', () => {
    const renderer = makeRenderer();
    const composer = new EffectComposer(renderer, 100, 100);
    const p1 = composer.addEffect({ outputNode: passthrough });
    composer.addEffect({ outputNode: passthrough });

    composer.removeEffect(p1);
    composer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    // 残り 1 pass: scene→targetA + 最終パス
    expect(renderer.render).toHaveBeenCalledTimes(2);
    composer.dispose();
  });

  it('render: active pass 0 のとき outputTarget へ描画する（CR-05）', () => {
    const renderer = makeRenderer();
    const composer = new EffectComposer(renderer, 100, 100);
    const rt = {} as THREE.RenderTarget;

    composer.render(new THREE.Scene(), new THREE.PerspectiveCamera(), rt);

    // null 固定ではなく指定された outputTarget へ出力する
    expect(renderer.setRenderTarget).toHaveBeenCalledWith(rt);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    composer.dispose();
  });

  it('render: 最終 pass の出力先を outputTarget へ向ける（CR-05）', () => {
    const renderer = makeRenderer();
    const composer = new EffectComposer(renderer, 100, 100);
    composer.addEffect({ outputNode: passthrough });
    const rt = {} as THREE.RenderTarget;

    composer.render(new THREE.Scene(), new THREE.PerspectiveCamera(), rt);

    expect(renderer.setRenderTarget).toHaveBeenCalledWith(rt);
    composer.dispose();
  });

  it('render: 外部 RT をバインド中でも呼び出し後に復元する（active pass 0・CR-05）', () => {
    const renderer = makeRenderer();
    const composer = new EffectComposer(renderer, 100, 100);
    const ext = {} as THREE.RenderTarget;
    renderer.setRenderTarget(ext);

    composer.render(new THREE.Scene(), new THREE.PerspectiveCamera(), null);

    expect(renderer.getRenderTarget()).toBe(ext);
    composer.dispose();
  });

  it('samples 指定で scene 描画専用の MSAA sceneTarget が確保される（CR-17）', () => {
    const composer = new EffectComposer(makeRenderer(4), 100, 100, 4);
    const sceneTarget = (
      composer as unknown as { sceneTarget: THREE.RenderTarget | null }
    ).sceneTarget;
    expect(sceneTarget).not.toBeNull();
    expect(sceneTarget!.samples).toBe(4);
    composer.dispose();
  });

  it('samples は renderer.capabilities.maxSamples で clamp される（CR-17）', () => {
    const composer = new EffectComposer(makeRenderer(4), 100, 100, 8);
    const sceneTarget = (
      composer as unknown as { sceneTarget: THREE.RenderTarget | null }
    ).sceneTarget;
    expect(sceneTarget!.samples).toBe(4);
    composer.dispose();
  });

  it('capabilities 未提供（init 前の WebGPU 等）なら上限 4 として clamp される（CR-17）', () => {
    const renderer = {
      getPixelRatio: () => 1,
      getRenderTarget: vi.fn(() => null),
      setRenderTarget: vi.fn(),
      render: vi.fn(),
      // capabilities なし
    } as unknown as THREE.WebGPURenderer;
    const composer = new EffectComposer(renderer, 100, 100, 8);
    const sceneTarget = (
      composer as unknown as { sceneTarget: THREE.RenderTarget | null }
    ).sceneTarget;
    expect(sceneTarget!.samples).toBe(4);
    composer.dispose();
  });

  it('samples=0 なら sceneTarget を作らない（無駄な RT を増やさない・CR-17）', () => {
    const composer = new EffectComposer(makeRenderer(4), 100, 100, 0);
    const sceneTarget = (
      composer as unknown as { sceneTarget: THREE.RenderTarget | null }
    ).sceneTarget;
    expect(sceneTarget).toBeNull();
    composer.dispose();
  });

  it('maxSamples=0 なら samples 指定でも sceneTarget を作らない（CR-17）', () => {
    const composer = new EffectComposer(makeRenderer(0), 100, 100, 4);
    const sceneTarget = (
      composer as unknown as { sceneTarget: THREE.RenderTarget | null }
    ).sceneTarget;
    expect(sceneTarget).toBeNull();
    composer.dispose();
  });

  it('sceneTarget 有効時は scene を sceneTarget へ描き、ping-pong は targetA/B のみ（CR-17）', () => {
    const renderer = makeRenderer(4);
    const composer = new EffectComposer(renderer, 100, 100, 4);
    composer.addEffect({ outputNode: passthrough });
    const internals = composer as unknown as {
      sceneTarget: THREE.RenderTarget;
    };

    composer.render(new THREE.Scene(), new THREE.PerspectiveCamera());

    // scene→sceneTarget、最終 pass→outputTarget(null) の 2 回描画
    expect(renderer.render).toHaveBeenCalledTimes(2);
    const calls = (renderer.setRenderTarget as ReturnType<typeof vi.fn>).mock
      .calls;
    // 最初の描画先が MSAA の sceneTarget
    expect(calls[0][0]).toBe(internals.sceneTarget);
    composer.dispose();
  });

  it('sceneTarget を含めて resize/dispose が例外なく通る（CR-17）', () => {
    const composer = new EffectComposer(makeRenderer(4), 100, 100, 4);
    expect(() => composer.resize(200, 150)).not.toThrow();
    const sceneTarget = (
      composer as unknown as { sceneTarget: THREE.RenderTarget }
    ).sceneTarget;
    const disposeSpy = vi.spyOn(sceneTarget, 'dispose');
    composer.dispose();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('render: 外部 RT をバインド中でも呼び出し後に復元する（pass 有り・CR-05）', () => {
    const renderer = makeRenderer();
    const composer = new EffectComposer(renderer, 100, 100);
    composer.addEffect({ outputNode: passthrough });
    const ext = {} as THREE.RenderTarget;
    renderer.setRenderTarget(ext);

    composer.render(new THREE.Scene(), new THREE.PerspectiveCamera(), null);

    expect(renderer.getRenderTarget()).toBe(ext);
    composer.dispose();
  });
});

describe('EffectPass', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('setUniform は既存 uniform ノードの値を更新する', () => {
    const { pass, uTime, uStrength } = makePass();

    pass.setUniform('uTime', 12.5);
    expect(uTime.value).toBe(12.5);

    pass.setUniform('uStrength', 0.9);
    expect(uStrength.value).toBe(0.9);
  });

  it('setUniform: 存在しない key を渡すと何もせず DEV では警告', () => {
    const { pass } = makePass();

    expect(() => pass.setUniform('nonExistent', 1)).not.toThrow();
    expect(pass.getUniform('nonExistent')).toBeUndefined();

    if (import.meta.env?.DEV) {
      expect(warnSpy).toHaveBeenCalled();
    }
  });

  it('getUniform は UniformNode を返す（存在しないときは undefined）', () => {
    const { pass, uTime } = makePass();

    expect(pass.getUniform('uTime')).toBe(uTime);
    expect(pass.getUniform('uTime')?.value).toBe(0);
    expect(pass.getUniform('missing')).toBeUndefined();
  });
});
