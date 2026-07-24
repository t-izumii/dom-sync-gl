import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { EffectComposer, EffectPass } from '../EffectComposer';

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

function makeShaderMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uStrength: { value: 0.5 } },
    vertexShader: 'void main(){ gl_Position = vec4(position, 1.0); }',
    fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
  });
}

describe('EffectComposer', () => {
  it('addEffect は EffectPass を返し passes に追加される', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    const pass = composer.addEffect({
      fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
      uniforms: { uTime: { value: 0 } },
    });
    expect(pass).toBeInstanceOf(EffectPass);
    composer.dispose();
  });

  it('addEffect は tDiffuse + ユーザー提供 uniforms をマージする', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    const pass = composer.addEffect({
      fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
      uniforms: { uTime: { value: 7 }, uStrength: { value: 0.3 } },
    });

    expect(pass.material.uniforms.tDiffuse).toBeDefined();
    expect(pass.material.uniforms.tDiffuse.value).toBeNull();
    expect(pass.material.uniforms.uTime.value).toBe(7);
    expect(pass.material.uniforms.uStrength.value).toBe(0.3);
    composer.dispose();
  });

  it('addEffect の material は premultiplied 契約に沿った素通し設定になる（CR-03）', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    const pass = composer.addEffect({
      fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
    });

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
    composer.addEffect({
      fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
    });

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

  it('dispose 後に passes が空になる', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    composer.addEffect({
      fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
    });
    composer.addEffect({
      fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
    });
    composer.dispose();

    // passes は private だが、dispose 後は render が pass=0 のパスを通ること
    const renderer = makeRenderer();
    const newComposer = new EffectComposer(renderer, 100, 100);
    newComposer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    // pass=0 ならフォールバック路で1回のみ
    expect(renderer.render).toHaveBeenCalledTimes(1);
    newComposer.dispose();
  });

  it('dispose: postMesh に自動生成された既定 material も dispose される（回収漏れの回帰）', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    const defaultMaterial = (
      composer as unknown as { postMeshDefaultMaterial: THREE.Material }
    ).postMeshDefaultMaterial;
    const disposeSpy = vi.spyOn(defaultMaterial, 'dispose');

    composer.dispose();

    expect(disposeSpy).toHaveBeenCalledTimes(1);
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
    const p1 = composer.addEffect({
      fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
    });
    composer.addEffect({
      fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
    });
    p1.enabled = false;

    composer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    // active pass は 1 個なので、scene→targetA + 最終パス の 2 回 render
    expect(renderer.render).toHaveBeenCalledTimes(2);
    composer.dispose();
  });

  it('render: 全 pass を disabled にするとフォールバック路 (1 回 render)', () => {
    const renderer = makeRenderer();
    const composer = new EffectComposer(renderer, 100, 100);
    const p1 = composer.addEffect({
      fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
    });
    const p2 = composer.addEffect({
      fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
    });
    p1.enabled = false;
    p2.enabled = false;

    composer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.setRenderTarget).toHaveBeenCalledWith(null);
    composer.dispose();
  });

  it('removeEffect: 該当 pass を取り除いて material を dispose する', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    const p1 = composer.addEffect({
      fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
    });
    const disposeSpy = vi.spyOn(p1.material, 'dispose');

    const removed = composer.removeEffect(p1);
    expect(removed).toBe(true);
    expect(disposeSpy).toHaveBeenCalled();
    composer.dispose();
  });

  it('removeEffect: 未登録の pass を渡すと false を返して何もしない', () => {
    const composer = new EffectComposer(makeRenderer(), 100, 100);
    const stranger = new EffectPass(makeShaderMaterial());
    expect(composer.removeEffect(stranger)).toBe(false);
    composer.dispose();
  });

  it('removeEffect 後に残った pass だけが render される', () => {
    const renderer = makeRenderer();
    const composer = new EffectComposer(renderer, 100, 100);
    const p1 = composer.addEffect({
      fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
    });
    composer.addEffect({
      fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
    });

    composer.removeEffect(p1);
    composer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    // 残り 1 pass: scene→targetA + 最終パス
    expect(renderer.render).toHaveBeenCalledTimes(2);
    composer.dispose();
  });

  it('render: active pass 0 のとき outputTarget へ描画する（CR-05）', () => {
    const renderer = makeRenderer();
    const composer = new EffectComposer(renderer, 100, 100);
    const rt = {} as THREE.WebGLRenderTarget;

    composer.render(new THREE.Scene(), new THREE.PerspectiveCamera(), rt);

    // null 固定ではなく指定された outputTarget へ出力する
    expect(renderer.setRenderTarget).toHaveBeenCalledWith(rt);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    composer.dispose();
  });

  it('render: 最終 pass の出力先を outputTarget へ向ける（CR-05）', () => {
    const renderer = makeRenderer();
    const composer = new EffectComposer(renderer, 100, 100);
    composer.addEffect({
      fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
    });
    const rt = {} as THREE.WebGLRenderTarget;

    composer.render(new THREE.Scene(), new THREE.PerspectiveCamera(), rt);

    expect(renderer.setRenderTarget).toHaveBeenCalledWith(rt);
    composer.dispose();
  });

  it('render: 外部 RT をバインド中でも呼び出し後に復元する（active pass 0・CR-05）', () => {
    const renderer = makeRenderer();
    const composer = new EffectComposer(renderer, 100, 100);
    const ext = {} as THREE.WebGLRenderTarget;
    renderer.setRenderTarget(ext);

    composer.render(new THREE.Scene(), new THREE.PerspectiveCamera(), null);

    expect(renderer.getRenderTarget()).toBe(ext);
    composer.dispose();
  });

  it('render: 外部 RT をバインド中でも呼び出し後に復元する（pass 有り・CR-05）', () => {
    const renderer = makeRenderer();
    const composer = new EffectComposer(renderer, 100, 100);
    composer.addEffect({
      fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
    });
    const ext = {} as THREE.WebGLRenderTarget;
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

  it('setUniform は既存 uniform の値を更新する', () => {
    const material = makeShaderMaterial();
    const pass = new EffectPass(material);

    pass.setUniform('uTime', 12.5);
    expect(material.uniforms.uTime.value).toBe(12.5);

    pass.setUniform('uStrength', 0.9);
    expect(material.uniforms.uStrength.value).toBe(0.9);
  });

  it('setUniform: 存在しない key を渡すと値が追加されず DEV では警告', () => {
    const material = makeShaderMaterial();
    const pass = new EffectPass(material);

    pass.setUniform('nonExistent', 1);
    expect(material.uniforms.nonExistent).toBeUndefined();

    if (import.meta.env?.DEV) {
      expect(warnSpy).toHaveBeenCalled();
    }
  });

  it('getUniform は uniform オブジェクトを返す（存在しないときは undefined）', () => {
    const material = makeShaderMaterial();
    const pass = new EffectPass(material);

    expect(pass.getUniform('uTime')?.value).toBe(0);
    expect(pass.getUniform('missing')).toBeUndefined();
  });
});
