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
