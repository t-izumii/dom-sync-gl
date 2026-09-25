# Post Effects

Extend `BaseEffect` and return a TSL `outputNode` factory. Pass it to `app.addEffect()` and it joins
the fullscreen chain. The result of the previous pass is available as `ctx.inputTexture`.

## A minimal effect

```ts
import { BaseEffect, type BaseEffectConfig, TSL } from 'dom-sync-gl';
const { uniform, vec2, vec4, fract, sin, dot } = TSL;

class GrainEffect extends BaseEffect {
  private uTime = uniform(0);

  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: ({ inputTexture, uv }) => {
        const g = fract(
          sin(dot(uv.add(this.uTime), vec2(12.9898, 78.233))).mul(43758.5453),
        );
        return vec4(inputTexture.rgb.add(g.sub(0.5).mul(0.06)), inputTexture.a);
      },
      uniforms: { uTime: this.uTime },
    };
  }
  update(time: number) {
    this.setUniform('uTime', time);
  }
}

app.addEffect(new GrainEffect());
```

`outputNode` is called **only once**, when the pass is added, and returns a node graph. From then on,
per-frame updates replace the `.value` of the `UniformNode`s passed in `uniforms` (that is, `setUniform()`).
`ctx.inputTexture` is a `TextureNode` that reads the output of the previous pass; used as-is, it is
sampled with `uv()` (to read it with a different UV, use `ctx.inputTexture.sample(customUv)`).

→ See [Demos / Post Effect](/en/demos/post-effect) for a working demo you can toggle.
→ See the [migration guide](/en/guide/migration-v0-4) to rewrite v0.3 GLSL (`fragmentShader` / `tDiffuse`).

## Per-plane chains

`plane.addEffect(effect)` builds a chain that applies only to that plane.
Internally, a `PlaneComposer` for the plane renders it into an FBO.

```ts
const plane = app.createPlane('.card', { colorNode });
plane.addEffect(new GrainEffect());
```

::: warning One effect = one plane / app
Adding the same `effect` instance to multiple targets with `addEffect` would run `update()` twice in
the same frame and could corrupt its internal state (duplicate registration throws).
Create a separate instance for each target.
:::

## enable / disable

```ts
const grain = app.addEffect(new GrainEffect());
grain.enabled = false; // pass-through
```

Setting `BaseEffect.enabled` to false skips the pass (resources are kept, so re-enabling is cheap).

## lil-gui integration

For effects that implement `setupGUI(gui)`, a folder appears in the panel automatically, **only when**
a lil-gui instance is passed in the `gui` option. Creating and disposing lil-gui is the caller's
responsibility; the library only uses the instance it receives (it is an optional peer, so
`npm install lil-gui` only when you use it).

```ts
import GUI from 'lil-gui';

const app = new DomSyncGL('#canvas', {
  gui: new GUI({ title: 'Effects' }),
});
```

Without `gui`, `setupGUI()` is not called. The former `showGUI` / `guiTitle` options were removed.

```ts
class GrainEffect extends BaseEffect {
  amount = 0.06;
  setupGUI(gui) {
    const f = gui.addFolder('Grain');
    f.add(this, 'amount', 0, 0.3);
    f.add(this, 'enabled');
  }
}
```

## Removing / disposing

```ts
app.removeEffect(grain);   // remove a single effect
app.clearEffects();        // dispose all of them
app.destroy();             // dispose the whole app (effects are disposed too)
```

## Feedback buffers (generators)

`BaseEffect` is a **post (filter / sink)** that takes an image and returns an image. `FeedbackBuffer`
works in **the opposite direction**: it is a **generator that produces a texture**. It reads its own
output from the previous frame (`uPrev`) through ping-pong RenderTargets and **accumulates state over
time**. Use it for mouse trails, fluids, diffusion, reaction-diffusion, and so on.

::: tip No compute shaders
The implementation is **only a ping-pong between two RenderTargets (render-to-texture)**. It does not
use WebGPU compute shaders (GPGPU), so it behaves the same on the WebGL 2 fallback. Accumulation
happens in 8-bit RGBA (a higher-precision RT may be offered as an option in the future for cases where
long decays cause visible banding).
:::

| | post (`addEffect` / `BaseEffect`) | generator (`addFeedback` / `FeedbackBuffer`) |
|---|---|---|
| Input | The previous render result (`ctx.inputTexture`) | Its own output from the previous frame (`uPrev`) + mouse, etc. |
| Output | Writes to the render pipeline (**sink**) | Produces a texture used as input by other shaders (**source**) |
| State | Mostly stateless (per frame) | A persistent buffer (two RTs) accumulated over time |
| Use | Finishing such as chromatic aberration, grain, blur | Generating material such as trails, fluids, diffusion |

### `plane.addFeedback()`

When attached to a plane, it is `step()`ped automatically every frame, and the output texture is fed
to the `texture()` node you specify (the library handles RT allocation, driving, resizing, and disposal).

The colorNode graph is **fixed at construction time**, so uniforms cannot be injected later.
**Declare the output `texture()` node in advance** in the `options.uniforms` of `createPlane`,
**with the same name as `outputUniform`**.

```ts
import { TSL } from 'dom-sync-gl';
const { texture, uniform, vec2, vec3, vec4, smoothstep, length } = TSL;

// 1. Create the output node in advance (addFeedback replaces its .value every frame)
const uTrailTex = texture();

// 2. Reference it from the plane's colorNode
const plane = app.createPlane('.card', {
  uniforms: { uTrailTex }, // pass it with the same name as outputUniform
  colorNode: () => vec4(vec3(uTrailTex.r), 1),
});

// 3. The feedback itself. outputNode reads its previous output (uPrev) and accumulates
const uDecay = uniform(0.94);
const uRadius = uniform(0.2);

const trail = plane.addFeedback({
  size: 256,
  outputUniform: 'uTrailTex',
  uniforms: { uDecay, uRadius },
  outputNode: ({ uPrev, uMouse, uHover, uAspect, uv }) => {
    const prev = uPrev.rgb.mul(uDecay);                        // decay the afterglow
    const d = uv.sub(uMouse).mul(vec2(uAspect, 1));
    const splat = smoothstep(uRadius, 0.0, length(d)).mul(uHover); // splat at the current position
    return vec4(prev.add(splat), 1);
  },
});

// Adjust or remove at runtime
uDecay.value = 0.9;            // directly, if you keep it in a variable
trail.uniforms.uDecay.value = 0.9; // or the same node through the buffer
plane.removeFeedback(trail);
```

### Nodes passed automatically (ctx of outputNode)

`uPrev` (the previous frame's output / `TextureNode`), `uMouse`, `uPrevMouse`, `uHover`, `uTime`,
`uResolution` (buffer resolution), `uAspect` (plane w/h), `uMove` (mouse movement), and `uv` are
available from ctx. `UniformNode`s passed in `uniforms` (such as `uDecay`) are also merged into
`ctx.uniforms` and can be updated at runtime through `buffer.uniforms.xxx.value`.

### Standalone use

`FeedbackBuffer` can also be used as a plain primitive independent of planes (pass `getRenderer()`).

```ts
import { FeedbackBuffer } from 'dom-sync-gl';
const fb = new FeedbackBuffer(app.getRenderer(), { outputNode, size: 256 });
const tex = fb.step({ mouse, hover, time, aspect }); // advance one frame and get the latest texture
fb.dispose();
```
