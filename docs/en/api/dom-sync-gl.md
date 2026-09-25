# DomSyncGL

The entry point of domSyncGL. It owns the renderer, scene, and camera, and is the hub for
`createPlane()` and `addEffect()`.

```ts
import { DomSyncGL } from 'dom-sync-gl';

const app = new DomSyncGL('#canvas', {
  scrollSync: true,
});
```

## Constructor

```ts
new DomSyncGL(selector: string | HTMLElement, options?: DomSyncGLOptions)
```

`selector` is the container the canvas is placed in: a string or an HTMLElement.

The renderer is `WebGPURenderer` from `three/webgpu`. Where WebGPU is unavailable it falls back to the
WebGL 2 backend automatically. Initialization is asynchronous, so await [`ready`](#ready) before doing
anything that depends on the backend (not awaiting it is safe; rendering is simply a no-op until
initialization completes).

## Options

| option | type | default | description |
|---|---|---|---|
| `scrollSync` | `boolean \| ScrollSyncOptions` | `false` | Enables scroll sync. See [Scroll](/en/api/scroll) |
| `autoRaf` | `boolean` | `true` | Whether to run the internal rAF loop. With `false`, drive it with [`tick()`](#tick-time) from your own rAF |
| `pauseWhenOffscreen` | `boolean` | `false` | With `scrollSync: { attach: 'dom' }`, stops the render loop while the container is outside the viewport. See [Scroll Sync](/en/guide/scroll-sync#stopping-rendering-off-screen) |
| `pauseRootMargin` | `string` | `'100%'` | IntersectionObserver `rootMargin` used by `pauseWhenOffscreen` |
| `enablePointerTracking` | `boolean` | `true` | Updates pointer coordinates and hover detection |
| `forceWebGL` | `boolean` | `false` | Forces the WebGL 2 backend even when WebGPU is available (for checking how the fallback looks and behaves) |
| `maxPixelRatio` | `number` | `2` | Upper limit for `renderer.setPixelRatio` (`1.5` recommended on mobile) |
| `outputColorSpace` | `THREE.ColorSpace` | `SRGBColorSpace` | Output color space of the renderer |
| `effectSamples` | `number` | `4` | MSAA sample count of the EffectComposer scene RenderTarget. `0` disables it. Clamped to the GPU limit (the WebGPU standard 4 if unavailable). Prevents jagged edges while effects are active |
| `stats` | `Stats \| null` | `null` | A stats.js instance created by the caller. When passed, `begin()`/`end()` are called every frame |
| `gui` | `GUI \| null` | `null` | A lil-gui instance created by the caller. When passed, the `setupGUI()` hooks are enabled |

::: tip stats.js / lil-gui are passed in
The former `showStats` / `showGUI` / `statsParent` / `guiTitle` options were removed. Creating them,
inserting them into the DOM, and disposing them are the caller's responsibility; the library only
receives and uses the instances. To keep them out of production bundles, create them only in
development with a dynamic import.

```ts
let stats: Stats | undefined;
let gui: GUI | undefined;
if (import.meta.env.DEV) {
  stats = new (await import('stats.js')).default();
  stats.showPanel(0);
  document.body.appendChild(stats.dom);
  gui = new (await import('lil-gui')).default({ title: 'Effects' });
}

const app = new DomSyncGL('#canvas', { stats, gui });
```
:::

`enableMouseTracking` remains as an alias of `enablePointerTracking`, but use the latter in new code.

## Properties

### `ready`

```ts
readonly ready: Promise<void>
```

A Promise that resolves when the renderer finishes asynchronous initialization (WebGPU device acquisition).

```ts
const app = new DomSyncGL('#canvas');
await app.ready;
console.log(app.isWebGPUBackend());
```

- It is safe not to await it. `render()` is a no-op until initialization completes, and you may call
  `createPlane()` and similar methods before initialization (`update()` does not touch the GPU, so it
  advances the state ahead of time)
- It rejects where neither WebGPU nor WebGL 2 is available (you can catch it if you await it; if you
  do not, it is still logged with console.error internally)

## Methods

### `createPlane(selector, options?)` / `removePlane(plane)`

Creates / removes a plane locked to a DOM element. Passing `null` as `selector` creates a fullscreen
background. Returns a [`DomPlane`](/en/api/dom-plane).

```ts
import { TSL } from 'dom-sync-gl';
const { uniform } = TSL;

const uIntensity = uniform(0.5);
const plane = app.createPlane('.card', {
  colorNode,
  uniforms: { uIntensity },
  updateRectEveryFrame: true,
  onInView: () => (uIntensity.value = 1),
});
app.removePlane(plane); // remove and destroy a single plane
```

### `createTextPlane(selector, options?)`

Rasterizes the text of a DOM element to a canvas and puts it on a plane locked to that element.
Returns a [`DomTextPlane`](/en/api/dom-text-plane) (a subclass of `DomPlane`).

```ts
const textPlane = app.createTextPlane('.headline', {
  updateRectEveryFrame: true,
});
```

Unlike `createPlane()`, `selector` cannot be `null` (a source DOM element is required).
Remove it with `removePlane()`.

### `tick(time?)`

Runs the update and rendering for one frame. Call it from your application's rAF loop when you
initialize with `autoRaf: false`. When using Lenis, call it **after** `lenis.raf(time)`.

While paused by `pauseWhenOffscreen`, `tick()` is a no-op (also with `autoRaf: false`).
The pause boundary is `tick()`; calling `update()` / `render()` directly is not guarded.

```ts
const app = new DomSyncGL('#canvas', { autoRaf: false });

const raf = (time: number) => {
  lenis.raf(time);
  app.tick(time);
  requestAnimationFrame(raf);
};
requestAnimationFrame(raf);
```

`time` is accepted only for API symmetry with Lenis and is not used internally (elapsed time comes
from the internal `THREE.Clock`). It works without it.

`tick()` is a thin facade that calls `update()` (state update) → `render()` (rendering) in order. Call
them separately if you want different timings for updating and rendering.

### `update(time?)` / `render(options?)`

`tick()` split into a state update phase and a rendering phase.

- `update(time?)` — DOM reads, scroll / pointer updates, and applying plane / object positions.
  It never runs a GPU render pass.
- `render(options?)` — Composites the plane composers and renders the final output.
  `options.outputTarget` (`THREE.RenderTarget | null`, default is the screen = `null`) sets the
  final output. **`render()` keeps the RenderTarget bound before the call bound after it (save and
  restore), and writes the final output only to `outputTarget`.** Useful when rendering multiple
  scenes to external FBOs for transitions, without breaking the external RenderTarget.
  It is a no-op until the renderer finishes initializing ([`ready`](#ready)).

```ts
// Render to an external FBO (the bound RT is not broken)
app.update(time);
app.render({ outputTarget: fbo });
```

### `isWebGPUBackend()`

Whether the WebGPU backend is in use. `false` on the WebGL 2 fallback (including `forceWebGL: true`).
The backend is decided after `ready` resolves, so **calls before initialization always return `false`**.

```ts
await app.ready;
if (!app.isWebGPUBackend()) {
  // e.g. lower the quality only on the WebGL 2 fallback
}
```

### `create3DObject(selector, options)` / `remove3DObject(obj)`

Fits a GLTF model to the bounding box of a DOM element. Returns a `Dom3DObject` (with `getModel()` / `resize()` / `destroy()`).

```ts
const obj = app.create3DObject('.product', {
  modelPath: '/models/shoe.gltf',
  fitMode: 'maxSide',
});
app.remove3DObject(obj);
```

| option | type | default | description |
|---|---|---|---|
| `modelPath` | `string` | — | Path to the GLTF |
| `scale` | `number` | `1` | Scale applied after fitting |
| `offset` | `Offset3D` | `{x:0,y:0,z:0}` | Offset applied after fitting |
| `fitMode` | `'maxSide' \| 'contain'` | `'maxSide'` | How the bounding box is matched to the DOM size |
| `updateRectEveryFrame` | `boolean` | `false` | Re-measures the DOM rect every frame. By default it is only re-measured on resize, so this is required for elements moved by GSAP / CSS animations |

### `addEffect(effect)` / `removeEffect(effect)` / `clearEffects()`

Manage the fullscreen chain. See [BaseEffect](/en/api/base-effect) for details.

### `setPostEffect(effectLike, options?)`

A low-level API that replaces the whole post effect pipeline with your own implementation, passed as
an `EffectLike` (implementing `render` / `resize` / `dispose`). Normally use `addEffect()`.
`resize()` is called with the current viewport size right after it is set (without waiting for the next resize).

**Ownership**: by default domSyncGL owns the postEffect you pass and calls `dispose()` on the previous
one when it is replaced (calling `setPostEffect()` again), on `clearEffects()`, and on `destroy()`.
To manage disposal yourself, pass `{ owned: false }` (domSyncGL will never dispose it).

```ts
app.setPostEffect(myEffect);                  // owned and disposed automatically by domSyncGL
app.setPostEffect(myEffect, { owned: false }); // disposal is the caller's responsibility
```

::: warning Do not combine with addEffect
Calling it while effects added with `addEffect()` exist disposes the internal EffectComposer and
replaces it. Call `clearEffects()` first (it throws in DEV).
:::

### `addObject(obj3d)` / `removeObject(obj3d)`

Low-level API to add meshes to and remove them from the scene directly.

### `addUpdateCallback(fn)` / `addResizeCallback(fn)`

```ts
const off = app.addUpdateCallback(() => {
  // called every frame
});
off(); // unsubscribe
```

### `setPointerTrackingEnabled(enabled)`

Turns the pointer listeners on and off dynamically, for example to stop hover detection while a heavy
UI is open. `setMouseTrackingEnabled()` remains as an alias.

### `isPaused()`

Whether rendering is paused off screen by `pauseWhenOffscreen`. Always `false` when it is disabled.
With `autoRaf: false` and your own loop, `tick()` becomes a no-op while paused but your application's
rAF keeps running, so skip your own per-frame work here as well.

```ts
const raf = (time: number) => {
  lenis.raf(time);
  app.tick(time);
  if (!app.isPaused()) {
    updateMyOwnStuff(time); // only while the canvas is visible
  }
  requestAnimationFrame(raf);
};
```

### Getters

| getter | returns | use |
|---|---|---|
| `getScene()` | `THREE.Scene` | The raw Three.js scene |
| `getCamera()` | `Camera` | Camera wrapper (`.instance` is a `THREE.PerspectiveCamera`) |
| `getRenderer()` | `THREE.WebGPURenderer` | The renderer (`three/webgpu`) |
| `getLight()` | `Light` | Wrapper for ambient + directional lights |
| `getViewPort()` | `DOMRect` | Logical rect of the canvas (matches the viewport exactly with ScrollSync) |
| `getMouse()` | `THREE.Vector2` | Canvas UV of the current frame (0..1, Y-up) |
| `getScroll()` | `Readonly<{ x: number; y: number }>` | Cached scroll value of the current frame, settled by the core on each rAF tick (a live reference; clone it to keep it) |
| `getPrevMouse()` | `THREE.Vector2` | UV of the previous frame |
| `getMouseDelta()` | `THREE.Vector2` | `current - prev` (a per-frame scratch value; clone it to keep it) |
| `isPointerActive()` | `boolean` | Whether the pointer is inside the canvas |
| `getPointerType()` | `'mouse' \| 'touch' \| 'pen' \| 'none'` | Current pointer type |
| `getControls()` | `OrbitControls \| null` | The instance after `enableOrbitControls()` |
| `getScrollSync()` | `ScrollSync \| null` | The internal instance when `scrollSync` is enabled |
| `getGUI()` | `GUI \| null` | The lil-gui instance passed in the `gui` option |

### `enableOrbitControls()`

Attaches three's `OrbitControls` to the canvas and returns it. With `scrollSync: true`, it re-enables
pointer events on the canvas only (the container has `pointer-events: none`) so input gets through.

### `destroy()`

Releases all listeners, textures, and render targets. Always call it when unmounting planes or the app in an SPA.
