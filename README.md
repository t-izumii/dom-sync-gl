# domSyncGL

[![npm](https://img.shields.io/npm/v/dom-sync-gl.svg)](https://www.npmjs.com/package/dom-sync-gl)
[![license](https://img.shields.io/npm/l/dom-sync-gl.svg)](./LICENSE)

English | [日本語](./README.ja.md)

A thin wrapper that places Three.js planes and 3D objects at the position of DOM elements, keeps them in sync with scrolling, and layers TSL-based post effects on top. WebGPU by default, with automatic fallback to WebGL 2.

## Features

- `createPlane(selector)` creates a Three.js mesh that follows the bounding box of a DOM element
- The renderer is `WebGPURenderer` from `three/webgpu`. It falls back to WebGL 2 where WebGPU is unavailable, and shaders are written in TSL, so one implementation covers both WGSL and GLSL
- `createTextPlane(selector)` turns DOM text into a plane (styles come from CSS, and the DOM stays in place)
- Corrects the offset between native scrolling and the canvas every frame
- Extend `BaseEffect` and return a TSL `outputNode` to chain post effects with ping-pong buffers
- Keeps the canvas height in step with the dynamic address bar of iOS Safari (`overscan`)
- You can own the rAF loop (`autoRaf: false` + `tick()`) and drive it together with Lenis and similar libraries in a single loop
- Stops the whole render loop while the canvas is off screen (`pauseWhenOffscreen`)
- lil-gui and stats.js are optional (install them only when you use them)

## Install

```bash
npm install dom-sync-gl three
```

The only required dependency is `three` (**0.181.x / 0.182.x**; the library uses the `three/webgpu` and `three/tsl` entry points).
The TSL API changes between three releases, so the peer dependency only covers the versions verified in CI.
Add these only if you want the GUI or FPS panels:

```bash
npm install lil-gui stats.js
```

For smooth scrolling, also add Lenis (not bundled; see [Scroll sync](#scroll-sync)):

```bash
npm install lenis
```

## Quick start

```html
<div id="canvas" style="position: absolute; inset: 0;"></div>
<div class="hero-card">Hello</div>
```

```ts
import { DomSyncGL, TSL } from "dom-sync-gl";
const { vec4, sin } = TSL;

const app = new DomSyncGL("#canvas", {
  scrollSync: true,
});

// A plane locked to the .hero-card element
app.createPlane(".hero-card", {
  colorNode: ({ uv, uTime }) =>
    vec4(uv, sin(uTime).mul(0.5).add(0.5), 1),
});

// A fullscreen background layer
app.createPlane(null, {
  colorNode: bgNode,
});
```

## Concepts

### WebGPU first / WebGL 2 fallback

The renderer is `WebGPURenderer` from `three/webgpu`. It uses WebGPU where available and falls back
to the WebGL 2 backend otherwise. Shaders are written as **TSL node factories** rather than GLSL strings,
and three compiles them to WGSL or GLSL, so you only write one implementation.

Acquiring a WebGPU device is asynchronous. Wait for initialization with `app.ready` (a Promise).

```ts
const app = new DomSyncGL("#canvas");
await app.ready; // Optional: render() is a no-op until initialization completes

app.isWebGPUBackend(); // false on the WebGL 2 fallback (and before ready resolves)
```

For debugging, the `forceWebGL: true` option forces the WebGL 2 backend.

### DOM-locked plane

`createPlane(selector)` creates a Three.js mesh that follows the position and size of the given DOM element. It tracks page scrolling pixel for pixel.

> [!IMPORTANT]
> For performance, the element's position and size (`getBoundingClientRect()`) are **only re-measured on resize by default**.
> If you move the element itself with GSAP, CSS animations, or transitions, the plane stays at the old position.
> Set `updateRectEveryFrame: true` on elements that move.
>
> | How the element moves | Followed by default? |
> |---|---|
> | Page scroll | Yes |
> | Window / container resize | Yes (after a 100 ms debounce) |
> | `position: sticky` elements | Yes (re-measured every frame automatically) |
> | transform / top / left animations, scrolling inside a parent element | **No** → `updateRectEveryFrame: true` |
> | Layout changes (elements added or removed, fonts loading, etc.) | **No** → `updateRectEveryFrame: true` or `app.resize()` |
>
> `updateRectEveryFrame` reads layout every frame for each plane, so only enable it on elements that move.

```ts
import { TSL } from "dom-sync-gl";
const { uniform } = TSL;

const uIntensity = uniform(0.5);
const plane = app.createPlane(".card", {
  colorNode,
  updateRectEveryFrame: true,  // for elements moved by CSS animations or GSAP
  uniforms: { uIntensity },    // your own uniform nodes (available as ctx.uniforms)
  onInView: () => (uIntensity.value = 1),
});
```

The argument (ctx) of the `colorNode` / `positionNode` factories provides nodes you can use without
declaring them (their values are updated internally):

| Node | Type | Description |
|---|---|---|
| `uTime` | `UniformNode<number>` | Elapsed seconds |
| `uResolution` | `UniformNode<Vector2>` | Plane size in pixels |
| `uMouseUV` | `UniformNode<Vector2>` | Plane-local UV (0..1) while hovered |
| `uIsHovered` | `UniformNode<number>` | 1 while the raycast hits, otherwise 0 |
| `uTexture` | `TextureNode` | Texture from the `data-texture` attribute or `setTexture()` |
| `uv` | `Node` | UV node |

Textures loaded from `data-texture` default to `SRGBColorSpace` (NodeMaterial converts linear to sRGB
on output, so the result matches the image in the DOM). Specify `textureColorSpace: THREE.NoColorSpace`
only when you want to pass raw values through.

### Scroll sync

With `scrollSync: true`, the container is attached to the document with `position: absolute`, and the
effective scrollY is applied to its transform on every rAF so it follows the viewport.

The effective scrollY is `-document.documentElement.getBoundingClientRect().top`. It normally equals
`window.scrollY`, but during the rubber-band effect and pull-to-refresh at the top of iOS Safari it
includes the visual viewport offset and goes negative. The same value drives both the container
transform and the plane positions, so the canvas and the DOM shift by the same amount during the
rubber-band effect, and pull-to-refresh keeps working.

```ts
const app = new DomSyncGL("#canvas", {
  scrollSync: true,
});

// To use scroll velocity (strength) in your effects
const app = new DomSyncGL("#canvas", {
  scrollSync: { trackStrength: true },
});
```

Protection against the canvas edges being cut off when the mobile URL bar resizes (`overscan`) is on
by default (`'auto'`). Extra space above and below is only reserved on `(pointer: coarse)` devices;
with a mouse it is 0, so nothing is wasted. Pass `scrollSync: { overscan: false }` to turn it off.

### Smooth scrolling (Lenis)

The library does not include Lenis; smooth scrolling is left to the application.
If you add it, **turn off the built-in rAF of both Lenis and the core, and drive them in order from a single loop**:

```ts
import { DomSyncGL } from "dom-sync-gl";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

const lenis = new Lenis({ autoRaf: false });
const app = new DomSyncGL("#canvas", {
  scrollSync: true,
  autoRaf: false,
});

const raf = (time: number) => {
  lenis.raf(time);   // settle the scroll position first,
  app.tick(time);    // then place WebGL using the settled value
  requestAnimationFrame(raf);
};
requestAnimationFrame(raf);
```

"Settle the scroll → place WebGL" then happens in the same frame and in the same order, so nothing drifts.

> ⚠️ If you leave `autoRaf: true` on both, Lenis and the core run **separate rAF loops**.
> Browsers run rAF callbacks in registration order, so if the core registers first it reads a scrollY
> that is one frame old, and the background canvas drifts while scrolling. A single loop guarantees the
> order regardless of registration.
>
> The former `rafScroll` option, `RafScroll` class, and `getRafScroll()` were **removed** as part of this change.

Touch input stays native by default (`syncTouch: false`), so pull-to-refresh keeps working.

### DOM text plane

`createTextPlane(selector)` renders the text of a DOM element to a canvas and puts it on a plane.
Styles come from `getComputedStyle`, so fluid values such as `font-size: clamp(...)` are resolved as-is.

```ts
app.createTextPlane(".headline", { updateRectEveryFrame: true });
```

The original DOM text only becomes `color: transparent`; it is not removed. Layout, screen readers,
text selection, and SEO are unaffected, and only the visuals are replaced by WebGL.

When loading web fonts dynamically, wait for `loadFont()` to resolve before creating the plane (fetching
and registering fonts is the job of a separate utility, not of `DomTextPlane`):

```ts
import { loadFont } from "dom-sync-gl";

const ready = loadFont({ family: "SpaceMono", url: "/fonts/space-mono.woff2" });
ready.then(() => app.createTextPlane(".headline"));
```

### Post effects

Extend `BaseEffect` and return a TSL `outputNode` factory. Pass it to `app.addEffect()` and it joins the fullscreen chain. The result of the previous pass is available as `ctx.inputTexture`.

```ts
import { BaseEffect, type BaseEffectConfig, TSL } from "dom-sync-gl";
const { vec2, vec4, fract, sin, dot } = TSL;

class GrainEffect extends BaseEffect {
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
    this.setUniform("uTime", time);
  }
}

app.addEffect(new GrainEffect());
```

`plane.addEffect(effect)` builds a per-plane chain instead.
While a plane is out of view, effect updates and feedback rendering stop, and they resume with the
paused time excluded. Effects that keep their own mouse history can reset it in `resume(time, mouse)`.
`feedback.size: 'screen'` uses the canvas size for fullscreen effects and the plane size × DPR for plane effects.
If you implement `setupGUI(gui)`, controls appear only when a lil-gui instance is passed in the `gui` option.

To migrate from the v0.3 GLSL API (`fragmentShader` / `tDiffuse` / `IUniform`), see
"Migrating from v0.3" in the documentation.

## API reference

### `new DomSyncGL(selector, options?)`

| option | type | default | description |
|---|---|---|---|
| `scrollSync` | `boolean \| ScrollSyncOptions` | `false` | Enables scroll sync |
| `autoRaf` | `boolean` | `true` | Whether to run the internal rAF loop. With `false`, drive it with `tick()` from your own rAF |
| `pauseWhenOffscreen` | `boolean` | `false` | With `scrollSync: { attach: 'dom' }`, stops the render loop while the canvas is off screen |
| `pauseRootMargin` | `string` | `'100%'` | IntersectionObserver `rootMargin` used by `pauseWhenOffscreen` |
| `enablePointerTracking` | `boolean` | `true` | Updates pointer coordinates and hover detection |
| `forceWebGL` | `boolean` | `false` | Forces the WebGL 2 backend even when WebGPU is available (for debugging) |
| `maxPixelRatio` | `number` | `2` | Upper limit for `renderer.setPixelRatio` (`1.5` recommended on mobile) |
| `outputColorSpace` | `THREE.ColorSpace` | `SRGBColorSpace` | Output color space of the renderer |
| `effectSamples` | `number` | `4` | MSAA sample count of the EffectComposer scene render target. `0` disables it |
| `stats` | `Stats \| null` | `null` | A stats.js instance created by the caller |
| `gui` | `GUI \| null` | `null` | A lil-gui instance created by the caller |

> `stats` and `gui` take **instances**. Creating them, inserting them into the DOM, and disposing them
> are the caller's responsibility; the library only uses what it receives. The former `showStats` /
> `showGUI` / `statsParent` / `guiTitle` options were **removed**.
> `enableMouseTracking` / `setMouseTrackingEnabled()` remain as aliases of the `enablePointerTracking` API.

#### Main methods / properties

- `ready` — Promise that resolves when the renderer finishes asynchronous initialization (WebGPU device acquisition). Safe to skip awaiting
- `isWebGPUBackend()` — Whether the WebGPU backend is in use (always `false` before `ready` resolves)
- `createPlane(selector, options?)` — Creates a plane locked to a DOM element (a fullscreen background when `selector` is `null`)
- `createTextPlane(selector, options?)` — Creates a plane with the DOM text rendered onto it
- `create3DObject(selector, options)` — Fits a GLTF model to a DOM element
- `tick(time?)` — Advances one frame (call it from your own rAF when `autoRaf: false`). Internally split into `update()` → `render()`, which can also be called separately
- `addEffect(effect)` / `removeEffect(effect)` — Manage the fullscreen chain
- `addObject(obj3d)` / `removeObject(obj3d)` — Add objects to the scene directly
- `addUpdateCallback(fn)` — Registers a per-frame callback (returns an unsubscribe function)
- `addResizeCallback(fn)` — Registers a resize callback
- `getScene()` / `getCamera()` / `getRenderer()` / `getMouse()` / `getScrollSync()` — Access internal instances
- `destroy()` — Releases all listeners, textures, and render targets

When you call `update()` and `render()` separately, `BaseEffect.update()` and feedback updates run
inside `render()` after the renderer has initialized. They use the time and mouse position fixed in
`update()`, so effects process the values of the same frame even if input changes just before rendering.

### `ScrollSyncOptions`

| option | type | default | description |
|---|---|---|---|
| `trackStrength` | `boolean` | `false` | Enables tracking of `strength` (scroll velocity) |
| `strengthDecay` | `number` | `10` | Exponential decay factor of strength |
| `overscan` | `number \| 'auto' \| false` | `'auto'` | Extends the canvas above and below the viewport, in px. `'auto'` uses `vh * 0.25` only with a coarse pointer and 0 with a mouse. `false` turns it off |
| `attach` | `'translate' \| 'dom'` | `'translate'` | How the container is attached. `'dom'` keeps the container's own CSS placement |

> Reading `strength` with `trackStrength: false` always returns `0` (with a one-time warning in DEV).

### `CreateTextPlaneOptions`

Extends `CreatePlaneOptions` with:

| option | type | default | description |
|---|---|---|---|
| `text` | `string` | `element.textContent` | Text to render instead |
| `style` | `TextStyleOverrides` | `{}` | Overrides individual values extracted from `getComputedStyle` |
| `pixelRatio` | `number` | `min(devicePixelRatio, 2)` | Resolution multiplier of the canvas |
| `hideElementText` | `boolean` | `true` | Whether to hide the original DOM text with `color: transparent` |

### `CreatePlaneOptions`

| option | type | default | description |
|---|---|---|---|
| `colorNode` | `(ctx: PlaneNodeContext) => Node` | Shows the texture as-is | TSL factory returning a vec4 node for the plane color |
| `positionNode` | `(ctx: PlaneNodeContext) => Node` | Default vertex processing | Factory returning a position node for vertex displacement |
| `uniforms` | `Record<string, UniformNode>` | `{}` | Your own nodes created with `uniform()` / `texture()` |
| `updateRectEveryFrame` | `boolean` | `false` | Re-measures the bbox every frame. By default it is only re-measured on resize, so this is required for elements moved by GSAP / CSS animations |
| `resizeInterval` | `number` | `100` | Minimum interval (ms) for buffer updates and text re-rendering while following size changes. The mesh follows every frame. `0` disables throttling |
| `segments` | `number` | `1` | PlaneGeometry segment count |
| `onInView` / `onOutView` | `(plane) => void` | — | IntersectionObserver callbacks |
| `inViewRootMargin` | `string` | `'100%'` | rootMargin of the IntersectionObserver |
| `inViewRepeat` | `boolean` | `false` | With `true`, `onInView` fires every time the plane enters the view |
| `crossOrigin` | `string` | `'anonymous'` | CORS attribute for `data-texture` loading |
| `textureColorSpace` | `THREE.ColorSpace` | `SRGBColorSpace` | Color space of textures loaded from `data-texture` |

### Exports

```ts
import {
  // Core
  DomSyncGL, Camera, Light, DomPlane, DomTextPlane, Dom3DObject,
  // Scroll
  ScrollSync,
  // Text
  loadFont, resolveTextStyle, layoutLines, rasterizeText,
  // Post effects
  EffectComposer, EffectPass, PlaneComposer, BaseEffect, FeedbackBuffer,
  // Extension base
  BaseScene,
  // Utility
  DomPositionCalculator,
  // Re-exports of three/webgpu and three/tsl (no separate import needed)
  THREE, TSL,
} from "dom-sync-gl";

import type {
  DomSyncGLOptions,
  CreatePlaneOptions,
  CreateTextPlaneOptions,
  PlaneNodeContext,
  TextStyleOverrides,
  ResolvedTextStyle,
  FontFaceSource,
  Create3DObjectOptions,
  Dom3DObjectFitMode,
  Offset3D,
  DOMPositionInfo,
  ScrollSyncOptions,
  PointerType,
  BaseEffectConfig,
  EffectOptions,
  EffectContext,
  EffectTarget,
  EffectLike,
  FeedbackBufferOptions,
  FeedbackInput,
  FeedbackContext,
  AddFeedbackOptions,
} from "dom-sync-gl";
```

## Browser support

- The latest two versions of Chrome / Edge / Firefox / Safari
- Falls back to the WebGL 2 backend where WebGPU is unavailable (WebGL 2 is required)
- IE11 and similar browsers are not supported

## Bundle

`three`, `lil-gui`, and `stats.js` are not bundled (peer dependencies; `three` must be **>=0.181.0 <0.183.0**).
`sideEffects: false` enables tree-shaking.
Lenis is not a runtime dependency either (install it in your application if you use it).

## Develop

```bash
npm install
npm run dev        # start the docs/ site with VitePress
npm run example    # start example/ with Vite (http://localhost:5180)
npm run build      # build into dist/
npm run test       # vitest
npm run test:gpu   # verify WebGPU / WebGL 2 rendering in a real browser (headless Chromium)
npm run typecheck  # the library itself (src/)
```

## License

MIT
