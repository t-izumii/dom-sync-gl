import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { MouseMotion } from '../MouseMotion';

const at = (x: number, y = 0.5): THREE.Vector2 => new THREE.Vector2(x, y);

describe('MouseMotion', () => {
  it('既定のノブは FeedbackBuffer と同じ', () => {
    const m = new MouseMotion();

    expect(m.threshold).toBe(0.0008);
    expect(m.scale).toBe(0.01);
    expect(m.release).toBe(0.85);
  });

  it('初回の prev は現在位置と同値（消費側が前回値の有無フラグを持たなくて済む）', () => {
    const m = new MouseMotion();

    m.update(at(0.3, 0.7), 1);

    expect(m.prev.x).toBeCloseTo(0.3);
    expect(m.prev.y).toBeCloseTo(0.7);
    expect(m.move).toBe(0);
  });

  it('prev は前フレームの位置を指す（今回の位置ではない）', () => {
    const m = new MouseMotion();
    m.update(at(0.3), 1);

    m.update(at(0.8), 1);

    expect(m.prev.x).toBeCloseTo(0.3);
  });

  it('prev は渡した Vector2 を参照せずコピーする', () => {
    const m = new MouseMotion();
    const shared = at(0.3);
    m.update(shared, 1);
    m.update(shared, 1);

    shared.set(0.9, 0.9);

    expect(m.prev.x).toBeCloseTo(0.3);
  });

  it('threshold 以下の微小な移動では move が 0', () => {
    const m = new MouseMotion();
    m.update(at(0.5), 1);

    m.update(at(0.5005), 1);

    expect(m.move).toBe(0);
  });

  it('scale の移動距離で 1 に到達し、テレポート相当でも 1 で頭打ち', () => {
    const m = new MouseMotion();
    m.update(at(0.0, 0.0), 1);

    m.update(at(1.0, 1.0), 1);

    expect(m.move).toBe(1);
  });

  it('scale に対する比率が move になる', () => {
    const m = new MouseMotion();
    m.update(at(0.5), 1);

    m.update(at(0.505), 1);

    expect(m.move).toBeCloseTo(0.5);
  });

  it('静止すると release 倍ずつ単調に減衰する', () => {
    const m = new MouseMotion();
    m.update(at(0.5), 1);
    m.update(at(0.505), 1);
    const peak = m.move;

    const decayed: number[] = [];
    for (let i = 0; i < 3; i++) {
      m.update(at(0.505), 1);
      decayed.push(m.move);
    }

    expect(decayed[0]).toBeCloseTo(peak * 0.85);
    expect(decayed[1]).toBeCloseTo(peak * 0.85 ** 2);
    expect(decayed[2]).toBeCloseTo(peak * 0.85 ** 3);
    expect(decayed[1]).toBeLessThan(decayed[0]);
    expect(decayed[2]).toBeLessThan(decayed[1]);
  });

  it('動き出しは減衰を待たず即座に立ち上がる（非対称）', () => {
    const m = new MouseMotion();
    m.update(at(0.5), 1);
    m.update(at(0.501), 1);
    const small = m.move;
    expect(small).toBeCloseTo(0.1);

    m.update(at(0.506), 1);

    expect(m.move).toBeCloseTo(0.5);
    expect(m.move).toBeGreaterThan(small * 0.85);
  });

  it('aspect が dx に掛かる（横長ほど同じ dx で move が大きい）', () => {
    const square = new MouseMotion();
    square.update(at(0.5), 1);
    square.update(at(0.502), 1);

    const wide = new MouseMotion();
    wide.update(at(0.5), 2);
    wide.update(at(0.502), 2);

    expect(square.move).toBeCloseTo(0.2);
    expect(wide.move).toBeCloseTo(0.4);
  });

  it('aspect は dy には掛からない', () => {
    const m = new MouseMotion();
    m.update(at(0.5, 0.5), 2);

    m.update(at(0.5, 0.502), 2);

    expect(m.move).toBeCloseTo(0.2);
  });

  it('有限でない aspect は 1 として扱う（NaN が move に伝播しない）', () => {
    for (const bad of [Infinity, NaN, -Infinity]) {
      const m = new MouseMotion();
      m.update(at(0.5), bad);
      m.update(at(0.502), bad);

      expect(m.move).toBeCloseTo(0.2);
    }
  });

  it('decay() は prev を動かさず move だけ減衰させる', () => {
    const m = new MouseMotion();
    m.update(at(0.5), 1);
    m.update(at(0.505), 1);
    const peak = m.move;

    m.decay();

    expect(m.move).toBeCloseTo(peak * 0.85);
    expect(m.prev.x).toBeCloseTo(0.5);
  });

  it('一度も update() していない状態で decay() しても 0 のまま', () => {
    const m = new MouseMotion();

    m.decay();

    expect(m.move).toBe(0);
  });

  it('ノブを書き換えると次の update() から反映される', () => {
    const m = new MouseMotion();
    m.scale = 0.02;
    m.update(at(0.5), 1);

    m.update(at(0.51), 1);

    expect(m.move).toBeCloseTo(0.5);
  });
});
