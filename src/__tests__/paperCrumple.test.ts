import { describe, it, expect } from 'vitest';
import { bakeCrumple, computeNormals } from '../effectsLib/paperCrumple/crumpleBake';

describe('bakeCrumple', () => {
  const bake = bakeCrumple({ segments: 40, aspect: 0.75, seed: 3 });

  it('コマ 0 は平らで、PlaneGeometry と同じ並びの格子になる', () => {
    const f0 = bake.frames[0];
    const cols = 41;
    expect(bake.vertexCount).toBe(cols * cols);
    // 四隅は動かさない（左上 → 右上 → 左下 → 右下）
    expect([f0[0], f0[1]]).toEqual([-0.5, 0.375]);
    expect([f0[40 * 3], f0[40 * 3 + 1]]).toEqual([0.5, 0.375]);
    expect([f0[40 * cols * 3], f0[40 * cols * 3 + 1]]).toEqual([-0.5, -0.375]);
    for (let i = 2; i < f0.length; i += 3) expect(f0[i]).toBe(0);
  });

  it('丸めきると球の大きさまで縮み、床（z = 0）の上に乗る', () => {
    const last = bake.frames[bake.frames.length - 1];
    let minZ = Infinity;
    let maxR = 0;
    let cz = 0;
    for (let i = 0; i < last.length; i += 3) {
      expect(Number.isFinite(last[i] + last[i + 1] + last[i + 2])).toBe(true);
      minZ = Math.min(minZ, last[i + 2]);
      cz += last[i + 2];
    }
    cz /= bake.vertexCount;
    for (let i = 0; i < last.length; i += 3) {
      maxR = Math.max(maxR, Math.hypot(last[i], last[i + 1], last[i + 2] - cz));
    }
    expect(minZ).toBeCloseTo(0, 6);
    expect(maxR).toBeLessThan(0.25);
  });

  it('同じ引数なら同じ結果になる', () => {
    const again = bakeCrumple({ segments: 40, aspect: 0.75, seed: 3 });
    expect(again.frames[20]).toEqual(bake.frames[20]);
  });

  it('平らな格子の法線は +z を向く', () => {
    const out = new Float32Array(bake.vertexCount * 3);
    computeNormals(bake.frames[0], bake.index, out);
    for (let i = 0; i < out.length; i += 3) expect(out[i + 2]).toBeCloseTo(1, 5);
  });
});
