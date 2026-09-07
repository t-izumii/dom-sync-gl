import { DomSyncGL, BaseEffect, THREE, TSL, type BaseEffectConfig } from '../../src/index';
import { RipplePostEffect } from '../../src/effectsLib/ripple/ripplePostEffect';
import { SplashCursorEffect } from '../../src/effectsLib/splashCursor/splashCursorEffect';
import { MouseEffect } from '../../src/effectsLib/mouse/mouseEffect';
import { MouseFlowEffect } from '../../src/effectsLib/mouseFlow/mouseFlowEffect';
import { DitherCursorEffect } from '../../src/effectsLib/ditherCursor/ditherCursorEffect';
import { SmoothCursorEffect } from '../../src/effectsLib/smoothCursor/smoothCursorEffect';
import { PixelTrailEffect } from '../../src/effectsLib/pixelTrail/pixelTrailEffect';

const output = document.querySelector('#results')!;
output.textContent = '';
const log = (message: string) => {
  const line = document.createElement('div');
  line.textContent = message;
  output.append(line);
  import.meta.hot?.send('gpu-regression:result', { message });
};
window.addEventListener('unhandledrejection', e => log(`UNHANDLED: ${e.reason}`));
window.addEventListener('error', e => log(`ERROR: ${e.message}`));
const assert = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
const near = (a: number, b: number, label: string) => assert(Math.abs(a - b) < 0.015, `${label}: ${a} != ${b}`);
// バックグラウンドタブでもタイマー/rAFの間引きに依存せず初期化の継続を待つ。
const nextTask = () => new Promise<void>(resolve => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    channel.port1.close(); channel.port2.close(); resolve();
  };
  channel.port2.postMessage(null);
});

class Identity extends BaseEffect {
  protected getConfig(): BaseEffectConfig { return { outputNode: ctx => ctx.inputTexture }; }
}
class SignedFeedback extends BaseEffect {
  protected getConfig(): BaseEffectConfig {
    return {
      feedback: { node: () => TSL.vec4(-0.25, 0.5, 0, 1), size: 16 },
      outputNode: () => TSL.vec4(this.feedbackTexture.r.add(0.5), 0, 0, 1),
    };
  }
}

async function runBackend(forceWebGL: boolean) {
  const app = new DomSyncGL(document.querySelector('#stage') as HTMLElement, {
    autoRaf: false, forceWebGL, maxPixelRatio: 1, effectSamples: 0,
  });
  const target = new THREE.RenderTarget(64, 64, { type: THREE.FloatType });
  try {
    await app.ready;
    const label = app.isWebGPUBackend() ? 'WebGPU' : 'WebGL2';
    if (!forceWebGL && label !== 'WebGPU') log('WebGPU unavailable: fallback used');
    const renderer = app.getRenderer();
    const device = (renderer as unknown as { backend: { device?: GPUDevice } }).backend.device;
    const check = async (name: string, work: () => Promise<void>) => {
      device?.pushErrorScope('validation');
      let failure: unknown;
      try { await work(); } catch (e) { failure = e; }
      const gpuError = await device?.popErrorScope();
      if (gpuError) failure = gpuError.message;
      log(`${failure ? 'FAIL' : 'PASS'} ${label} ${name}${failure ? `: ${failure}` : ''}`);
      app.clearEffects();
    };
    const read = async () => {
      if (app.isWebGPUBackend()) {
        return Array.from(await renderer.readRenderTargetPixelsAsync(target, 32, 32, 1, 1));
      }
      // three の非同期 WebGL 読み戻しは rAF を待つため、非表示タブでは停止する。
      // 検証専用の1ピクセル読み戻しは同期で行い、元の GL バインドを復元する。
      const backend = (renderer as unknown as {
        backend: { get(texture: THREE.Texture): { textureGPU: WebGLTexture } };
      }).backend;
      const gl = renderer.getContext() as unknown as WebGL2RenderingContext;
      const previous = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      const framebuffer = gl.createFramebuffer();
      const pixels = new Float32Array(4);
      try {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D,
          backend.get(target.texture).textureGPU, 0);
        assert(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, 'Incomplete read framebuffer');
        gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.FLOAT, pixels);
        assert(gl.getError() === gl.NO_ERROR, 'WebGL error during rendering/readback');
        return Array.from(pixels);
      } finally {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous);
        gl.deleteFramebuffer(framebuffer);
      }
    };
    const render = () => { app.update(); app.render({ outputTarget: target }); };
    const plane = app.createPlane(null, { colorNode: () => TSL.vec4(0.8, 0.4, 0.2, 0.5) });
    await check('premultiplied plane identity', async () => {
      render(); const baseline = await read();
      near(baseline[3], 0.5, 'baseline alpha');
      assert(baseline[0] > 0.1, 'baseline must contain rendered color');
      const effect = plane.addEffect(new Identity());
      try {
        render(); const composed = await read();
        baseline.forEach((v, i) => near(composed[i], v, `channel ${i}`));
      } finally {
        plane.removeEffect(effect);
      }
    });
    await check('fullscreen identity chain', async () => {
      render(); const baseline = await read();
      app.addEffect(new Identity()); app.addEffect(new Identity());
      render(); const composed = await read();
      baseline.forEach((v, i) => near(composed[i], v, `channel ${i}`));
      app.clearEffects();
    });
    await check('signed feedback values', async () => {
      app.addEffect(new SignedFeedback());
      await nextTask();
      render(); const pixel = await read();
      near(pixel[0], 0.25, 'negative feedback encoded red');
      app.clearEffects();
    });
    for (const make of [
      () => new RipplePostEffect({ resolution: 32 }),
      () => new SplashCursorEffect({ simResolution: 32, dyeResolution: 64, pressureIterations: 3 }),
      () => new MouseEffect({ simResolution: 32, dyeResolution: 64, pressureIterations: 3 }),
      () => new MouseFlowEffect(), () => new DitherCursorEffect(),
      () => new SmoothCursorEffect(), () => new PixelTrailEffect({ textureSize: 64 }),
    ]) {
      const effect = make();
      await check(effect.constructor.name, async () => {
        app.addEffect(effect);
        await nextTask();
        for (let i = 0; i < 6; i++) {
          await nextTask();
          app.getMouse().set(0.3 + i * 0.05, 0.4 + i * 0.02);
          render();
        }
        const pixel = await read();
        assert(pixel.every(Number.isFinite), `Non-finite output: ${pixel}`);
      });
      app.clearEffects();
    }
  } finally {
    target.dispose(); app.destroy();
  }
}

async function main() {
  for (const fallback of [false, true]) {
    try { await runBackend(fallback); } catch (e) { log(`FAIL backend ${fallback}: ${e}`); }
  }
  log('DONE');
}
void main();
