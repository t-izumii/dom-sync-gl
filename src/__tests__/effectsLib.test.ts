import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { RipplePostEffect } from '../effectsLib/ripple/ripplePostEffect';
import { FluidSim } from '../effectsLib/splashCursor/fluidSim';
import { SplashCursorEffect } from '../effectsLib/splashCursor/splashCursorEffect';

function makeRenderer(width: number, height: number) {
  const drawingBuffer = new THREE.Vector2(width, height);
  return {
    drawingBuffer,
    getSize: (t: THREE.Vector2) => t.copy(drawingBuffer),
    getDrawingBufferSize: (t: THREE.Vector2) => t.copy(drawingBuffer),
  };
}

describe('RipplePostEffect', () => {
  it('グリッドが変わらないリサイズでは波の RenderTarget を作り直さない', () => {
    const renderer = makeRenderer(800, 400);
    const effect = new RipplePostEffect({ resolution: 64 });
    effect._setRenderer(renderer as unknown as THREE.WebGPURenderer);
    const read = (effect as unknown as { read: THREE.RenderTarget }).read;

    effect.resize(800, 401);
    expect((effect as unknown as { read: THREE.RenderTarget }).read).toBe(read);

    effect.resize(800, 800);
    const rebuilt = (effect as unknown as { read: THREE.RenderTarget }).read;
    expect(rebuilt).not.toBe(read);
    expect([rebuilt.width, rebuilt.height]).toEqual([64, 64]);
    effect._dispose();
  });
});

describe('FluidSim', () => {
  it('解像度が変わらないときはバッファを作り直さない', () => {
    const renderer = makeRenderer(800, 400);
    const sim = new FluidSim(renderer as unknown as THREE.WebGPURenderer);
    sim.buildFramebuffers(32, 64);
    const dye = sim.dyeTexture;

    sim.buildFramebuffers(32, 64);
    expect(sim.dyeTexture).toBe(dye);

    renderer.drawingBuffer.set(400, 800);
    sim.buildFramebuffers(32, 64);
    expect(sim.dyeTexture).not.toBe(dye);
    sim.dispose();
  });
});

describe('SplashCursorEffect', () => {
  it('クリックの splat は owner から渡されたマウス UV に置く', () => {
    const effect = new SplashCursorEffect();
    const splat = vi.fn();
    Object.assign(effect, {
      pass: {},
      renderer: {},
      sim: { aspect: 1, splat, step: vi.fn(), dyeTexture: null, dispose: vi.fn() },
    });
    const mouse = new THREE.Vector2(0.2, 0.7);
    effect.update(0, mouse);
    splat.mockClear();

    window.dispatchEvent(new Event('pointerdown'));
    effect.update(0.01, mouse);

    expect(splat).toHaveBeenCalledTimes(1);
    expect(splat.mock.calls[0].slice(0, 2)).toEqual([0.2, 0.7]);
    effect._dispose();
  });
});
