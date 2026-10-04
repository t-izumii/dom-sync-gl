import { afterEach, expect, it, vi } from 'vitest';
import { Vector2 } from 'three/webgpu';
import { TrailTexture } from '../effectsLib/pixelTrail/TrailTexture';

afterEach(() => vi.restoreAllMocks());

it('補間点数は距離に比例し、極小半径でも上限を超えない', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect() {} } as never);
  const trail = new TrailTexture({ radius: 0.1, interpolate: 5 });
  trail.addTouch(new Vector2(0, 0));
  trail.addTouch(new Vector2(0.2, 0));
  const points = (trail as unknown as { trail: { x: number }[] }).trail;
  expect(points.length).toBe(21);
  expect(points[10].x).toBeCloseTo(0.1);
  expect(points[20].x).toBeCloseTo(0.2);
  trail.radius = 0;
  trail.addTouch(new Vector2(1, 1));
  expect(points.length).toBe(21 + 512);
  trail.dispose();
});

it('点が無い間はテクスチャを再アップロードしない', () => {
  const ctx = {
    fillRect: vi.fn(),
    createRadialGradient: () => ({ addColorStop() {} }),
    beginPath() {},
    arc() {},
    fill() {},
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
  const trail = new TrailTexture({ maxAge: 100 });
  const initial = trail.texture.version;

  trail.update(0.016);
  expect(trail.texture.version).toBe(initial);

  trail.addTouch(new Vector2(0.5, 0.5));
  trail.update(0.016);
  expect(trail.texture.version).toBe(initial + 1);

  // 寿命切れのフレームで一度だけ消去を送り、以降は止まる。
  trail.update(0.2);
  expect(trail.texture.version).toBe(initial + 2);
  trail.update(0.016);
  expect(trail.texture.version).toBe(initial + 2);
  trail.dispose();
});
