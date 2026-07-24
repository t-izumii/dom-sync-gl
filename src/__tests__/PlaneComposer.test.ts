import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { PlaneComposer } from '../PlaneComposer';

function makeRenderer(): THREE.WebGLRenderer {
  let current: THREE.WebGLRenderTarget | null = null;
  return {
    getPixelRatio: () => 1,
    getRenderTarget: vi.fn(() => current),
    setRenderTarget: vi.fn((t: THREE.WebGLRenderTarget | null = null) => {
      current = t;
    }),
    render: vi.fn(),
  } as unknown as THREE.WebGLRenderer;
}

function makeSourceMesh(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(10, 20, 0);
  mesh.scale.set(100, 50, 1);
  return mesh;
}

describe('PlaneComposer', () => {
  it('構築時に sourceMesh を mainScene から外し、代わりに proxyMesh を追加する', () => {
    const scene = new THREE.Scene();
    const sourceMesh = makeSourceMesh();
    scene.add(sourceMesh);

    const composer = new PlaneComposer(makeRenderer(), sourceMesh, scene, 100, 50);

    expect(scene.children).not.toContain(sourceMesh);
    // proxyMesh が 1 つ追加されている（sourceMesh 以外の Mesh）
    expect(scene.children.length).toBe(1);
    expect(scene.children[0]).not.toBe(sourceMesh);
    composer.dispose();
  });

  it('addEffect は EffectPass を返し、以後 render で使われる', () => {
    const scene = new THREE.Scene();
    const sourceMesh = makeSourceMesh();
    const renderer = makeRenderer();
    const composer = new PlaneComposer(renderer, sourceMesh, scene, 100, 50);

    const pass = composer.addEffect({
      fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
    });
    expect(pass).toBeDefined();
    expect(pass.enabled).toBe(true);
    composer.dispose();
  });

  it('addEffect の material は premultiplied 契約に沿った素通し設定になる（CR-03）', () => {
    const scene = new THREE.Scene();
    const sourceMesh = makeSourceMesh();
    const composer = new PlaneComposer(makeRenderer(), sourceMesh, scene, 100, 50);
    const pass = composer.addEffect({
      fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
    });

    expect(pass.material.blending).toBe(THREE.NoBlending);
    expect(pass.material.transparent).toBe(false);
    expect(pass.material.depthTest).toBe(false);
    expect(pass.material.depthWrite).toBe(false);
    composer.dispose();
  });

  it('proxyMaterial は premultipliedAlpha:true で合成する（CR-03）', () => {
    const scene = new THREE.Scene();
    const sourceMesh = makeSourceMesh();
    const composer = new PlaneComposer(makeRenderer(), sourceMesh, scene, 100, 50);

    const proxyMaterial = (
      composer as unknown as { proxyMaterial: THREE.MeshBasicMaterial }
    ).proxyMaterial;
    expect(proxyMaterial.premultipliedAlpha).toBe(true);
    expect(proxyMaterial.transparent).toBe(true);
    composer.dispose();
  });

  it('render: 有効な pass が 0 個なら bypass に入り sourceMesh が mainScene に戻る', () => {
    const scene = new THREE.Scene();
    const sourceMesh = makeSourceMesh();
    const composer = new PlaneComposer(makeRenderer(), sourceMesh, scene, 100, 50);

    // pass を 1 つも追加していない = activeCount 0
    composer.render();

    expect(scene.children).toContain(sourceMesh); // bypass: 元の mesh が描画される
    composer.dispose();
  });

  it('render: 有効な pass が 1 個以上あれば通常経路（sourceMesh は隠れ、proxy 経由で描画）', () => {
    const scene = new THREE.Scene();
    const sourceMesh = makeSourceMesh();
    const renderer = makeRenderer();
    const composer = new PlaneComposer(renderer, sourceMesh, scene, 100, 50);
    composer.addEffect({ fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }' });

    composer.render();

    expect(scene.children).not.toContain(sourceMesh); // bypass ではない
    // localScene→targetA (1回) + pass 1個分のポストパス (1回) = 2回 render
    expect(renderer.render).toHaveBeenCalledTimes(2);
    composer.dispose();
  });

  it('render: 外部 RT をバインド中でも呼び出し後に復元する（CR-05）', () => {
    const scene = new THREE.Scene();
    const sourceMesh = makeSourceMesh();
    const renderer = makeRenderer();
    const composer = new PlaneComposer(renderer, sourceMesh, scene, 100, 50);
    composer.addEffect({ fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }' });
    const ext = {} as THREE.WebGLRenderTarget;
    renderer.setRenderTarget(ext);

    composer.render();

    // 末尾の setRenderTarget(null) 固定をやめ、呼び出し前の RT を復元する
    expect(renderer.getRenderTarget()).toBe(ext);
    composer.dispose();
  });

  it('render: 全 pass を disabled にすると bypass 経路に戻る', () => {
    const scene = new THREE.Scene();
    const sourceMesh = makeSourceMesh();
    const renderer = makeRenderer();
    const composer = new PlaneComposer(renderer, sourceMesh, scene, 100, 50);
    const pass = composer.addEffect({ fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }' });
    pass.enabled = false;

    composer.render();

    expect(scene.children).toContain(sourceMesh);
    composer.dispose();
  });

  it('render: sourceMesh.visible=false なら proxyMesh も隠して何もしない', () => {
    const scene = new THREE.Scene();
    const sourceMesh = makeSourceMesh();
    const renderer = makeRenderer();
    const composer = new PlaneComposer(renderer, sourceMesh, scene, 100, 50);
    composer.addEffect({ fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }' });
    sourceMesh.visible = false;

    composer.render();

    expect(renderer.render).not.toHaveBeenCalled();
    composer.dispose();
  });

  it('removeEffect: 登録済み pass を取り除き material を dispose する', () => {
    const scene = new THREE.Scene();
    const sourceMesh = makeSourceMesh();
    const composer = new PlaneComposer(makeRenderer(), sourceMesh, scene, 100, 50);
    const pass = composer.addEffect({ fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }' });
    const disposeSpy = vi.spyOn(pass.material, 'dispose');

    expect(composer.removeEffect(pass)).toBe(true);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(composer.removeEffect(pass)).toBe(false); // 二重削除は false
    composer.dispose();
  });

  it('dispose: bypass 中でなければ sourceMesh を mainScene に戻し、proxy 関連リソースを解放する', () => {
    const scene = new THREE.Scene();
    const sourceMesh = makeSourceMesh();
    const renderer = makeRenderer();
    const composer = new PlaneComposer(renderer, sourceMesh, scene, 100, 50);
    const pass = composer.addEffect({ fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }' });
    composer.render(); // 通常経路に入れておく（bypass ではない状態）
    const matDisposeSpy = vi.spyOn(pass.material, 'dispose');

    composer.dispose();

    expect(scene.children).toContain(sourceMesh); // 呼び出し元が引き続き扱えるよう復元される
    expect(matDisposeSpy).toHaveBeenCalledTimes(1);
  });

  it('dispose: postMesh に自動生成された既定 material も dispose される（回収漏れの回帰）', () => {
    const scene = new THREE.Scene();
    const sourceMesh = makeSourceMesh();
    const composer = new PlaneComposer(makeRenderer(), sourceMesh, scene, 100, 50);
    const defaultMaterial = (
      composer as unknown as { postMeshDefaultMaterial: THREE.Material }
    ).postMeshDefaultMaterial;
    const disposeSpy = vi.spyOn(defaultMaterial, 'dispose');

    composer.dispose();

    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('dispose 後は addEffect すると例外を投げる', () => {
    const scene = new THREE.Scene();
    const sourceMesh = makeSourceMesh();
    const composer = new PlaneComposer(makeRenderer(), sourceMesh, scene, 100, 50);
    composer.dispose();

    expect(() =>
      composer.addEffect({ fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }' })
    ).toThrow();
  });

  it('RenderTarget を depthBuffer:false で生成する（CR-18）', () => {
    const scene = new THREE.Scene();
    const sourceMesh = makeSourceMesh();
    const composer = new PlaneComposer(makeRenderer(), sourceMesh, scene, 100, 50);
    const internals = composer as unknown as {
      targetA: THREE.WebGLRenderTarget;
      targetB: THREE.WebGLRenderTarget;
    };

    expect(internals.targetA.depthBuffer).toBe(false);
    expect(internals.targetB.depthBuffer).toBe(false);
    composer.dispose();
  });

  it('resize は例外を投げずに解像度を更新できる', () => {
    const scene = new THREE.Scene();
    const sourceMesh = makeSourceMesh();
    const composer = new PlaneComposer(makeRenderer(), sourceMesh, scene, 100, 50);

    expect(() => composer.resize(200, 120)).not.toThrow();
    composer.dispose();
  });
});
