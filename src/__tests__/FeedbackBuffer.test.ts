import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { FeedbackBuffer } from '../FeedbackBuffer';
import type { FeedbackContext } from '../FeedbackBuffer';

// FeedbackBuffer は renderer の setRenderTarget/render/clear/getClearColor 等しか呼ばないので、
// GPU コンテキスト不要の最小スタブで ping-pong ロジックを検証する（RenderTarget は
// 構築だけなら GPU 不要で jsdom でも作れる）。
class StubRenderer {
  target: THREE.RenderTarget | null = null;
  renderCount = 0;
  clearCount = 0;
  getRenderTarget() {
    return this.target;
  }
  setRenderTarget(t: THREE.RenderTarget | null) {
    this.target = t;
  }
  getClearColor(c: THREE.Color) {
    return c;
  }
  getClearAlpha() {
    return 1;
  }
  setClearColor() {}
  clear() {
    this.clearCount++;
  }
  render() {
    this.renderCount++;
  }
}

// 前フレームの結果をそのまま返す素通しノード（旧 passthrough fragmentShader 相当）
const passthrough = (ctx: FeedbackContext) => ctx.uPrev;
const asRenderer = (r: StubRenderer) => r as unknown as THREE.WebGPURenderer;

describe('FeedbackBuffer', () => {
  it('step() で write に焼いて swap し、最新テクスチャを返す（ping-pong）', () => {
    const r = new StubRenderer();
    const fb = new FeedbackBuffer(asRenderer(r), { outputNode: passthrough, size: 64 });

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

  it('RT の初期クリアはコンストラクタでは行わず、初回 step() で一度だけ実行する（遅延クリア）', () => {
    // renderer.init() 完了前に GPU コマンドを発行しない契約。
    const r = new StubRenderer();
    const fb = new FeedbackBuffer(asRenderer(r), { outputNode: passthrough });
    expect(r.clearCount).toBe(0); // 構築時は GPU を触らない

    fb.step({ mouse: new THREE.Vector2(), hover: 0, time: 0, aspect: 1 });
    expect(r.clearCount).toBe(2); // read / write の 2 枚を一度だけクリア

    fb.step({ mouse: new THREE.Vector2(), hover: 0, time: 16, aspect: 1 });
    expect(r.clearCount).toBe(2); // 2 回目以降はクリアしない
    fb.dispose();
  });

  it('step() で uPrev / uMouse / uHover / uTime / uAspect が更新される', () => {
    const r = new StubRenderer();
    const fb = new FeedbackBuffer(asRenderer(r), {
      outputNode: passthrough,
      uniforms: { uDecay: uniform(0.9) },
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
    const fb = new FeedbackBuffer(asRenderer(r), { outputNode: passthrough });
    const before = fb.texture;
    fb.dispose();
    const after = fb.step({ mouse: new THREE.Vector2(), hover: 0, time: 0, aspect: 1 });
    expect(after).toBe(before);
    expect(r.renderCount).toBe(0); // 構築〜dispose まで一度も render していない
    expect(r.clearCount).toBe(0); // 遅延クリアも走らない
  });

  it('予約名 uniform を渡すと throw する（CR-11）', () => {
    const r = new StubRenderer();
    expect(
      () =>
        new FeedbackBuffer(asRenderer(r), {
          outputNode: passthrough,
          uniforms: { uMouse: uniform(new THREE.Vector2()) },
        }),
    ).toThrow(/uMouse/);
  });

  it('予約名以外のカスタム uniform は従来どおり通る（CR-11）', () => {
    const r = new StubRenderer();
    const fb = new FeedbackBuffer(asRenderer(r), {
      outputNode: passthrough,
      uniforms: { uDecay: uniform(0.9) },
    });
    expect(fb.uniforms.uDecay.value).toBe(0.9);
    fb.dispose();
  });

  it('outputNode ファクトリはコンストラクタで一度だけ呼ばれ、ctx から内部ノードとユーザー uniform を参照できる', () => {
    const r = new StubRenderer();
    const uDecay = uniform(0.9);
    let captured: FeedbackContext | null = null;
    const fb = new FeedbackBuffer(asRenderer(r), {
      outputNode: (ctx) => {
        captured = ctx;
        return ctx.uPrev;
      },
      uniforms: { uDecay },
    });

    expect(captured).not.toBeNull();
    expect(captured!.uniforms.uDecay).toBe(uDecay);
    expect(captured!.uPrev.value).toBe(fb.texture); // 初期値は read RT のテクスチャ
    fb.dispose();
  });

  it('render の前後で renderTarget を元に戻す（呼び出し側の状態を壊さない）', () => {
    const r = new StubRenderer();
    const sentinel = new THREE.RenderTarget(8, 8);
    r.target = sentinel; // 呼び出し側が別 RT を bind している状態
    const fb = new FeedbackBuffer(asRenderer(r), { outputNode: passthrough });
    fb.step({ mouse: new THREE.Vector2(), hover: 0, time: 0, aspect: 1 });
    expect(r.target).toBe(sentinel); // step 後に元の RT へ復元される
    fb.dispose();
    sentinel.dispose();
  });
});
