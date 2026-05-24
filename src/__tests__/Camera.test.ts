import { describe, it, expect } from 'vitest';
import { Camera } from '../Camera';
import { CAMERA_FOV } from '../constants';

describe('Camera', () => {
  it('constructor で「DOM 1px = WebGL 1unit」になる距離に z を置く', () => {
    const rect = new DOMRect(0, 0, 800, 600);
    const cam = new Camera(rect);
    const fovRad = (CAMERA_FOV / 2) * (Math.PI / 180);
    const expectedDistance = 600 / 2 / Math.tan(fovRad);
    expect(cam.instance.position.z).toBeCloseTo(expectedDistance);
    expect(cam.instance.aspect).toBeCloseTo(800 / 600);
  });

  it('constructor: 0 サイズ rect が来ても aspect / position.z が NaN にならない', () => {
    const rect = new DOMRect(0, 0, 0, 0);
    const cam = new Camera(rect);
    expect(Number.isFinite(cam.instance.aspect)).toBe(true);
    expect(Number.isFinite(cam.instance.position.z)).toBe(true);
  });

  it('resize: 通常サイズで aspect と position.z を更新する', () => {
    const cam = new Camera(new DOMRect(0, 0, 800, 600));
    cam.resize(new DOMRect(0, 0, 1600, 900));
    expect(cam.instance.aspect).toBeCloseTo(1600 / 900);
    const fovRad = (CAMERA_FOV / 2) * (Math.PI / 180);
    expect(cam.instance.position.z).toBeCloseTo(900 / 2 / Math.tan(fovRad));
  });

  it('resize: 0 サイズ rect は early-return で更新しない', () => {
    const cam = new Camera(new DOMRect(0, 0, 800, 600));
    const prevAspect = cam.instance.aspect;
    const prevZ = cam.instance.position.z;
    cam.resize(new DOMRect(0, 0, 0, 0));
    // 0 が来ても projectionMatrix が壊れないことが重要 (NaN にならない)
    expect(cam.instance.aspect).toBe(prevAspect);
    expect(cam.instance.position.z).toBe(prevZ);
  });

  it('resize: 1px 等の極小サイズでも NaN にならない (safeWidth/safeHeight クランプ)', () => {
    const cam = new Camera(new DOMRect(0, 0, 800, 600));
    cam.resize(new DOMRect(0, 0, 1, 1));
    expect(Number.isFinite(cam.instance.aspect)).toBe(true);
    expect(Number.isFinite(cam.instance.position.z)).toBe(true);
  });
});
