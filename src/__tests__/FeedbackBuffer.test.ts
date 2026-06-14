import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FeedbackBuffer } from '../FeedbackBuffer';

// FeedbackBuffer は renderer の setRenderTarget/render/clear/getClearColor 等しか呼ばないので、
// GL コンテキスト不要の最小スタブで ping-pong ロジックを検証する（WebGLRenderTarget は
// 構築だけなら GL 不要で jsdom でも作れる）。
class StubRenderer {
  target: THREE.WebGLRenderTarget | null = null;
  renderCount = 0;
  getRenderTarget() {
    return this.target;
  }
  setRenderTarget(t: THREE.WebGLRenderTarget | null) {
    this.target = t;
  }
  getClearColor(c: THREE.Color) {
    return c;
  }
  getClearAlpha() {
    return 1;
  }
  setClearColor() {}
  clear() {}
  render() {
    this.renderCount++;
  }
}

const FRAG = 'void main() { gl_FragColor = vec4(0.0); }';
const asRenderer = (r: StubRenderer) => r as unknown as THREE.WebGLRenderer;

describe('FeedbackBuffer', () => {
  it('step() で write に焼いて swap し、最新テクスチャを返す（ping-pong）', () => {
    const r = new StubRenderer();
    const fb = new FeedbackBuffer(asRenderer(r), { fragmentShader: FRAG, size: 64 });

    const t0 = fb.texture;
    const t1 = fb.step({ mouse: new THREE.Vector2(0.5, 0.5), hover: 1, time: 0, aspect: 1 });

    expect(t1).not.toBe(t0); // swap した（read が入れ替わった）
    expect(fb.texture).toBe(t1); // texture getter は最新を返す
    expect(r.renderCount).toBeGreaterThan(0); // write へ render した

    // RT は 2 枚なので 2 回 swap で元の read に戻る
    const t2 = fb.step({ mouse: new THREE.Vector2(0.5, 0.5), hover: 1, time: 16, aspect: 1 });
    expect(t2).toBe(t0);
    fb.dispose();
  });

  it('step() で uPrev / uMouse / uHover / uTime / uAspect が更新される', () => {
    const r = new StubRenderer();
    const fb = new FeedbackBuffer(asRenderer(r), {
      fragmentShader: FRAG,
      uniforms: { uDecay: { value: 0.9 } },
    });
    expect(fb.uniforms.uDecay.value).toBe(0.9); // ユーザー uniform がマージされる

    fb.step({ mouse: new THREE.Vector2(0.3, 0.7), hover: 0.5, time: 42, aspect: 1.5 });
    expect((fb.uniforms.uMouse.value as THREE.Vector2).x).toBeCloseTo(0.3);
    expect((fb.uniforms.uMouse.value as THREE.Vector2).y).toBeCloseTo(0.7);
    expect(fb.uniforms.uHover.value).toBe(0.5);
    expect(fb.uniforms.uTime.value).toBe(42);
    expect(fb.uniforms.uAspect.value).toBe(1.5);
    expect(fb.uniforms.uPrev.value).not.toBeNull(); // 前フレームが set された
    fb.dispose();
  });

  it('dispose() 後の step() は no-op（render せず最新 texture を返すだけ）', () => {
    const r = new StubRenderer();
    const fb = new FeedbackBuffer(asRenderer(r), { fragmentShader: FRAG });
    const before = fb.texture;
    fb.dispose();
    const after = fb.step({ mouse: new THREE.Vector2(), hover: 0, time: 0, aspect: 1 });
    expect(after).toBe(before);
    expect(r.renderCount).toBe(0); // 構築時の clear は render を呼ばない
  });

  it('render の前後で renderTarget を元に戻す（呼び出し側の状態を壊さない）', () => {
    const r = new StubRenderer();
    const sentinel = new THREE.WebGLRenderTarget(8, 8);
    r.target = sentinel; // 呼び出し側が別 RT を bind している状態
    const fb = new FeedbackBuffer(asRenderer(r), { fragmentShader: FRAG });
    fb.step({ mouse: new THREE.Vector2(), hover: 0, time: 0, aspect: 1 });
    expect(r.target).toBe(sentinel); // step 後に元の RT へ復元される
    fb.dispose();
    sentinel.dispose();
  });
});
