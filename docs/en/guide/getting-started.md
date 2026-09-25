# Getting Started

## Install

```bash
npm install dom-sync-gl three
```

The only required dependency is `three` (**0.181.x / 0.182.x**; the library uses the `three/webgpu` and `three/tsl` entry points).
The TSL API changes between three releases, so the peer dependency only covers the versions verified in CI.
Add these if you want the GUI or FPS panels:

```bash
npm install lil-gui stats.js
```

For smooth scrolling, also add [Lenis](https://github.com/darkroomengineering/lenis)
(not bundled; see [Scroll Sync](/en/guide/scroll-sync#smooth-scrolling-lenis)):

```bash
npm install lenis
```

## Minimal code

Shaders are written as **TSL (Three.js Shading Language) node factories** rather than GLSL strings.
You can import the node builders from `three/tsl` directly or use the re-exported `TSL`.

```html
<div id="canvas" style="position: absolute; inset: 0;"></div>
<div class="hero-card">Hello</div>
```

```ts
import { DomSyncGL, TSL } from 'dom-sync-gl';
const { vec4, sin } = TSL;

const app = new DomSyncGL('#canvas');

app.createPlane('.hero-card', {
  colorNode: ({ uv, uTime }) =>
    vec4(uv, sin(uTime).mul(0.5).add(0.5), 1),
});
```

The plane sticks to the position and size of `.hero-card` and tracks page scrolling pixel for pixel.

::: warning Moving elements need `updateRectEveryFrame: true`
For performance, the element's position and size (`getBoundingClientRect()`) are **only re-measured on resize by default**.
If you move the element itself with GSAP, CSS animations, or transitions, the plane stays at the old position.

| How the element moves | Followed by default? |
|---|---|
| Page scroll | Yes |
| Window / container resize | Yes (after a 100 ms debounce) |
| `position: sticky` elements | Yes (re-measured every frame automatically) |
| transform / top / left animations, scrolling inside a parent element | **No** → `updateRectEveryFrame: true` |
| Layout changes (elements added or removed, fonts loading, etc.) | **No** → `updateRectEveryFrame: true` or `app.resize()` |

`updateRectEveryFrame` reads layout every frame for each plane, so only enable it on elements that move.
:::

→ See [Demos / DOM-locked Plane](/en/demos/plane) for a working demo, code, and notes.
→ See the [migration guide](/en/guide/migration-v0-4) to rewrite code written for the v0.3 GLSL API.

## WebGPU and the WebGL 2 fallback

The renderer is `WebGPURenderer` from `three/webgpu`. **It uses WebGPU where available and
automatically falls back to the WebGL 2 backend otherwise.** three compiles TSL shaders to WGSL or
GLSL, so you only write one implementation.

Acquiring a WebGPU device is asynchronous. Wait for initialization with `app.ready` (a Promise).

```ts
const app = new DomSyncGL('#canvas');
await app.ready; // Optional: render() is a no-op until initialization completes

if (app.isWebGPUBackend()) {
  console.log('Running on WebGPU');
}
```

- `await app.ready` is **not required**. You can call `createPlane()` and similar methods before
  initialization; only rendering is a no-op until it completes. Await it only when you need to act
  after the backend is decided (such as branching on `isWebGPUBackend()`)
- For debugging, the `forceWebGL: true` option forces the WebGL 2 backend
  (useful for checking how the fallback looks and behaves)

```ts
const app = new DomSyncGL('#canvas', { forceWebGL: true });
```

## Built-in nodes for colorNode

The argument of the `colorNode` / `positionNode` factories (`PlaneNodeContext`) provides nodes you
can use without declaring them (their values are updated internally).

| Node | Type | Contents |
|---|---|---|
| `uTime` | `UniformNode<number>` | Elapsed seconds |
| `uResolution` | `UniformNode<Vector2>` | Plane size in pixels |
| `uMouseUV` | `UniformNode<Vector2>` | Plane-local UV (0..1) while hovered |
| `uPrevMouse` | `UniformNode<Vector2>` | `uMouseUV` of the previous frame (same coordinate system) |
| `uMove` | `UniformNode<number>` | Mouse movement intensity (0..1) |
| `uIsHovered` | `UniformNode<number>` | 1 while the raycast hits, otherwise 0 |
| `uTexture` | `TextureNode` | Texture from the `data-texture` attribute or `setTexture()` |
| `uAlpha` | `UniformNode<number>` | Opacity (default 1.0) |
| `uniforms` | `Record<string, UniformNode>` | Your own uniforms passed in `options.uniforms` |
| `uv` | `Node` | UV node |

The factory is called **only once**, when the plane is created, and returns a node graph. Changes
from frame to frame are applied by replacing the `.value` of these nodes (the graph itself is not rebuilt).

## Using it as a fullscreen background

Pass `null` as the `selector` to create a fullscreen background plane.

```ts
app.createPlane(null, { colorNode: bgNode });
```

## Turning text into a plane

`createTextPlane()` renders DOM text to a canvas and draws it as a plane. The DOM text only becomes
`color: transparent`, so layout, accessibility, and text selection remain.

```ts
app.createTextPlane('.headline');
```

## Owning the rAF loop

By default the library runs its own rAF loop. To keep the order in step with smooth scrolling such as
Lenis, set `autoRaf: false` and call `tick()` from your own loop.

```ts
const app = new DomSyncGL('#canvas', { autoRaf: false });

const raf = (time: number) => {
  lenis.raf(time);
  app.tick(time);
  requestAnimationFrame(raf);
};
requestAnimationFrame(raf);
```

When combined with [`pauseWhenOffscreen`](/en/guide/scroll-sync#stopping-rendering-off-screen),
`tick()` becomes a no-op while paused, but your own rAF keeps running. If you also want to skip your
own heavy work, branch on `app.isPaused()`.

## Next steps

- [Demos](/en/demos/) — working samples with copyable code
- [Scroll Sync](/en/guide/scroll-sync) — align scrolling and the canvas within one frame
- [Text Planes](/en/guide/text-planes) — put text layers under WebGL control
- [Post Effects](/en/guide/post-effects) — write effects with `BaseEffect`
- [Migrating from v0.3](/en/guide/migration-v0-4) — GLSL → TSL mapping and rewrite examples
- [API: DomSyncGL](/en/api/dom-sync-gl) — all options
