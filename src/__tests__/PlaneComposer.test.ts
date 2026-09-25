import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { PlaneComposer } from '../PlaneComposer';
import type { EffectContext } from '../EffectComposer';
import { vec4 } from 'three/tsl';

function makeRenderer(): THREE.WebGPURenderer {
  let current: THREE.RenderTarget | null = null;
  return {
    getPixelRatio: () => 1,
    getRenderTarget: vi.fn(() => current),
    setRenderTarget: vi.fn((t: THREE.RenderTarget | null = null) => {
      current = t;
    }),
    render: vi.fn(),
  } as unknown as THREE.WebGPURenderer;
}

function makeSourceMesh(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(10, 20, 0);
  mesh.scale.set(100, 50, 1);
  return mesh;
}

// 前段の出力をそのまま返す素通しエフェクト（旧 passthrough fragmentShader 相当）
const passthrough = (ctx: EffectContext) => ctx.inputTexture;

// displayMaterial は private のためテストから参照するためのアクセサ。
function getDisplayMaterial(composer: PlaneComposer): THREE.MeshBasicNodeMaterial {
  return (composer as unknown as { displayMaterial: THREE.MeshBasicNodeMaterial })
    .displayMaterial;
}

describe('PlaneComposer', () => {
  it('構築だけでは sourceMesh の material を差し替えない（scene への add/remove もしない）', () => {
    const sourceMesh = makeSourceMesh();
    const original = sourceMesh.material;
    const scene = new THREE.Scene();
    scene.add(sourceMesh);

    const composer = new PlaneComposer(makeRenderer(), sourceMesh, 100, 50);

    expect(sourceMesh.material).toBe(original);
    // sourceMesh は scene に残ったまま（新方式は proxy を足さない）
    expect(scene.children).toEqual([sourceMesh]);
    composer.dispose();
  });

  it('addEffect は EffectPass を返し、以後 render で使われる', () => {
    const sourceMesh = makeSourceMesh();
    const renderer = makeRenderer();
    const composer = new PlaneComposer(renderer, sourceMesh, 100, 50);

    const pass = composer.addEffect({ outputNode: passthrough });
    expect(pass).toBeDefined();
    expect(pass.enabled).toBe(true);
    composer.dispose();
  });

  it('addEffect の material は premultiplied 契約に沿った素通し設定になる（CR-03）', () => {
    const sourceMesh = makeSourceMesh();
    const composer = new PlaneComposer(makeRenderer(), sourceMesh, 100, 50);
    const pass = composer.addEffect({ outputNode: passthrough });

    expect(pass.material.blending).toBe(THREE.NoBlending);
    expect(pass.material.transparent).toBe(false);
    expect(pass.material.depthTest).toBe(false);
    expect(pass.material.depthWrite).toBe(false);
    composer.dispose();
  });

  it('乗算済み RT の色を NodeMaterial の出力処理で再乗算せず合成する', () => {
    const sourceMesh = makeSourceMesh();
    const composer = new PlaneComposer(makeRenderer(), sourceMesh, 100, 50);

    const displayMaterial = getDisplayMaterial(composer);
    // 実際の NodeMaterial.setupOutput を通して追加の alpha 乗算ノードが
    // 入らないことを検証する。material のフラグだけの検証では見逃していた回帰。
    const input = vec4(0.4, 0.2, 0.1, 0.5);
    expect(displayMaterial.setupOutput({} as THREE.NodeBuilder, input)).toBe(input);
    expect(displayMaterial.transparent).toBe(true);
    expect(displayMaterial.blending).toBe(THREE.CustomBlending);
    expect(displayMaterial.blendEquation).toBe(THREE.AddEquation);
    expect(displayMaterial.blendSrc).toBe(THREE.OneFactor);
    expect(displayMaterial.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
    expect(displayMaterial.blendEquationAlpha).toBe(THREE.AddEquation);
    expect(displayMaterial.blendSrcAlpha).toBe(THREE.OneFactor);
    expect(displayMaterial.blendDstAlpha).toBe(THREE.OneMinusSrcAlphaFactor);
    composer.dispose();
  });

  it('render: 有効な pass が 0 個なら originalMaterial に戻す（bypass）', () => {
    const sourceMesh = makeSourceMesh();
    const original = sourceMesh.material;
    const composer = new PlaneComposer(makeRenderer(), sourceMesh, 100, 50);

    // pass を 1 つも追加していない = activeCount 0
    composer.render();

    expect(sourceMesh.material).toBe(original);
    composer.dispose();
  });

  it('render: 有効な pass が 1 個以上あれば sourceMesh の material を displayMaterial に差し替える', () => {
    const sourceMesh = makeSourceMesh();
    const scene = new THREE.Scene();
    scene.add(sourceMesh);
    const renderer = makeRenderer();
    const composer = new PlaneComposer(renderer, sourceMesh, 100, 50);
    composer.addEffect({ outputNode: passthrough });

    composer.render();

    // sourceMesh は scene に残ったまま material だけ合成結果に切り替わる
    expect(scene.children).toEqual([sourceMesh]);
    expect(sourceMesh.material).toBe(getDisplayMaterial(composer));
    // localScene→targetA (1回) + pass 1個分のポストパス (1回) = 2回 render
    expect(renderer.render).toHaveBeenCalledTimes(2);
    composer.dispose();
  });

  it('render: 最終読み取り RT が displayTexture ノードの value に反映される', () => {
    const sourceMesh = makeSourceMesh();
    const renderer = makeRenderer();
    const composer = new PlaneComposer(renderer, sourceMesh, 100, 50);
    composer.addEffect({ outputNode: passthrough });
    const internals = composer as unknown as {
      targetB: THREE.RenderTarget;
      displayTexture: { value: THREE.Texture };
    };

    composer.render();

    // pass 1 個: localScene→targetA、pass が targetB へ書いて swap → 表示は targetB
    expect(internals.displayTexture.value).toBe(internals.targetB.texture);
    composer.dispose();
  });

  it('render: effect 有効化の前後で renderOrder / layers / frustumCulled が変わらない', () => {
    const sourceMesh = makeSourceMesh();
    sourceMesh.renderOrder = 5;
    sourceMesh.frustumCulled = false;
    sourceMesh.layers.set(2);
    const layerMaskBefore = sourceMesh.layers.mask;
    const renderer = makeRenderer();
    const composer = new PlaneComposer(renderer, sourceMesh, 100, 50);
    composer.addEffect({ outputNode: passthrough });

    composer.render();

    // 同一 Object3D のまま material だけ差し替わるので描画状態は維持される
    expect(sourceMesh.renderOrder).toBe(5);
    expect(sourceMesh.frustumCulled).toBe(false);
    expect(sourceMesh.layers.mask).toBe(layerMaskBefore);
    composer.dispose();
  });

  it('render: originalMaterial の depthTest/depthWrite/side を displayMaterial へ同期する', () => {
    const sourceMesh = makeSourceMesh();
    const original = sourceMesh.material as THREE.Material;
    original.depthTest = false;
    original.depthWrite = false;
    original.side = THREE.DoubleSide;
    const composer = new PlaneComposer(makeRenderer(), sourceMesh, 100, 50);
    composer.addEffect({ outputNode: passthrough });

    composer.render();

    const displayMaterial = getDisplayMaterial(composer);
    expect(displayMaterial.depthTest).toBe(false);
    expect(displayMaterial.depthWrite).toBe(false);
    expect(displayMaterial.side).toBe(THREE.DoubleSide);
    composer.dispose();
  });

  it('render: 外部 RT をバインド中でも呼び出し後に復元する（CR-05）', () => {
    const sourceMesh = makeSourceMesh();
    const renderer = makeRenderer();
    const composer = new PlaneComposer(renderer, sourceMesh, 100, 50);
    composer.addEffect({ outputNode: passthrough });
    const ext = {} as THREE.RenderTarget;
    renderer.setRenderTarget(ext);

    composer.render();

    // 末尾の setRenderTarget(null) 固定をやめ、呼び出し前の RT を復元する
    expect(renderer.getRenderTarget()).toBe(ext);
    composer.dispose();
  });

  it('render: 全 pass を disabled にすると originalMaterial に戻る（bypass）', () => {
    const sourceMesh = makeSourceMesh();
    const original = sourceMesh.material;
    const renderer = makeRenderer();
    const composer = new PlaneComposer(renderer, sourceMesh, 100, 50);
    const pass = composer.addEffect({ outputNode: passthrough });

    // まず有効化して displayMaterial にしておく
    composer.render();
    expect(sourceMesh.material).toBe(getDisplayMaterial(composer));

    pass.enabled = false;
    composer.render();

    expect(sourceMesh.material).toBe(original);
    composer.dispose();
  });

  it('render: sourceMesh.visible=false なら何もしない', () => {
    const sourceMesh = makeSourceMesh();
    const renderer = makeRenderer();
    const composer = new PlaneComposer(renderer, sourceMesh, 100, 50);
    composer.addEffect({ outputNode: passthrough });
    sourceMesh.visible = false;

    composer.render();

    expect(renderer.render).not.toHaveBeenCalled();
    composer.dispose();
  });

  it('removeEffect: 登録済み pass を取り除き material を dispose する', () => {
    const sourceMesh = makeSourceMesh();
    const composer = new PlaneComposer(makeRenderer(), sourceMesh, 100, 50);
    const pass = composer.addEffect({ outputNode: passthrough });
    const disposeSpy = vi.spyOn(pass.material, 'dispose');

    expect(composer.removeEffect(pass)).toBe(true);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(composer.removeEffect(pass)).toBe(false); // 二重削除は false
    composer.dispose();
  });

  it('dispose: sourceMesh の material を originalMaterial に戻し displayMaterial を dispose する', () => {
    const sourceMesh = makeSourceMesh();
    const original = sourceMesh.material;
    const renderer = makeRenderer();
    const composer = new PlaneComposer(renderer, sourceMesh, 100, 50);
    const pass = composer.addEffect({ outputNode: passthrough });
    composer.render(); // displayMaterial に差し替えた状態にしておく
    expect(sourceMesh.material).toBe(getDisplayMaterial(composer));

    const displayDisposeSpy = vi.spyOn(getDisplayMaterial(composer), 'dispose');
    const matDisposeSpy = vi.spyOn(pass.material, 'dispose');

    composer.dispose();

    expect(sourceMesh.material).toBe(original); // 呼び出し元が引き続き扱えるよう復元
    expect(displayDisposeSpy).toHaveBeenCalledTimes(1);
    expect(matDisposeSpy).toHaveBeenCalledTimes(1);
  });

  it('dispose 後は addEffect すると例外を投げる', () => {
    const sourceMesh = makeSourceMesh();
    const composer = new PlaneComposer(makeRenderer(), sourceMesh, 100, 50);
    composer.dispose();

    expect(() => composer.addEffect({ outputNode: passthrough })).toThrow();
  });

  it('RenderTarget を depthBuffer:false で生成する（CR-18）', () => {
    const sourceMesh = makeSourceMesh();
    const composer = new PlaneComposer(makeRenderer(), sourceMesh, 100, 50);
    const internals = composer as unknown as {
      targetA: THREE.RenderTarget;
      targetB: THREE.RenderTarget;
    };

    expect(internals.targetA.depthBuffer).toBe(false);
    expect(internals.targetB.depthBuffer).toBe(false);
    composer.dispose();
  });

  it('resize は例外を投げずに解像度を更新できる', () => {
    const sourceMesh = makeSourceMesh();
    const composer = new PlaneComposer(makeRenderer(), sourceMesh, 100, 50);

    expect(() => composer.resize(200, 120)).not.toThrow();
    composer.dispose();
  });
});
