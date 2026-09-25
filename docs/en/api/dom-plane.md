# DomPlane

The return value of `app.createPlane()`. A wrapper around a Three.js mesh and material that follows the position of a DOM element.

## CreatePlaneOptions

| option | type | default | description |
|---|---|---|---|
| `colorNode` | `(ctx: PlaneNodeContext) => Node` | Shows the texture as-is | TSL factory returning a vec4 node for the plane color |
| `positionNode` | `(ctx: PlaneNodeContext) => Node` | Default vertex processing | Factory returning a position node for vertex displacement |
| `uniforms` | `Record<string, UniformNode>` | `{}` | Your own nodes created with TSL `uniform()` / `texture()`. Available as `ctx.uniforms` |
| `updateRectEveryFrame` | `boolean` | `false` | Re-measures the bbox every frame. By default it is only re-measured on resize, so this is required for elements moved by GSAP / CSS animations |
| `segments` | `number` | `1` | PlaneGeometry segment count (for vertex displacement) |
| `onInView` / `onOutView` | `(plane) => void` | — | IntersectionObserver callbacks |
| `inViewRootMargin` | `string` | `'100%'` | rootMargin of the IntersectionObserver |
| `inViewRepeat` | `boolean` | `false` | With `true`, fires every time the plane enters or leaves the view |
| `crossOrigin` | `string` | `'anonymous'` | CORS attribute for `data-texture` loading |
| `setupGUI` | `(gui, plane) => GUI \| void` | — | Hook that builds lil-gui controls for the plane. [See below](#setupgui) |
| `textureColorSpace` | `THREE.ColorSpace` | `SRGBColorSpace` | Color space of textures loaded from `data-texture`. [See below](#texturecolorspace) |

`colorNode` / `positionNode` are called **only once**, when the plane is created, and return a node graph.
From then on, per-frame updates replace the `.value` of the ctx nodes (the graph is not rebuilt).

## PlaneNodeContext (built-in nodes)

The argument of the `colorNode` / `positionNode` factories. It provides nodes you can use without declaring them.

| Node | Type | Contents |
|---|---|---|
| `uTime` | `UniformNode<number>` | Elapsed seconds |
| `uResolution` | `UniformNode<Vector2>` | Plane size in pixels |
| `uTexture` | `TextureNode` | Texture from the `data-texture` attribute or `setTexture()` |
| `uAlpha` | `UniformNode<number>` | Opacity (default 1.0) |
| `uMouseUV` | `UniformNode<Vector2>` | Plane-local UV while hovered (0..1, bottom-left origin) |
| `uPrevMouse` | `UniformNode<Vector2>` | `uMouseUV` of the previous frame (same bottom-left origin). Equal to `uMouseUV` on the first frame |
| `uMove` | `UniformNode<number>` | Mouse movement intensity (0..1). Falls gradually to 0 when the mouse stops |
| `uIsHovered` | `UniformNode<number>` | 1 while the raycast hits, otherwise 0 (float) |
| `uniforms` | `Record<string, UniformNode>` | Your own nodes passed in `options.uniforms` |
| `uv` | `Node` | UV node |

These names are **reserved uniform names**. Passing a node with the same name in `options.uniforms`
throws (they are updated internally every frame).

## Methods

### `addEffect(effect)` / `removeEffect(effect)`

A per-plane chain of **post effects** (sinks that write to the render pipeline). See [Post Effects](/en/guide/post-effects).

### `addFeedback(options)` / `removeFeedback(buffer)`

Attaches a **feedback buffer (generator)** to the plane. It accumulates state over time with a
ping-pong between two RenderTargets and feeds its output texture every frame to the `texture()` node
with the same name as `options.outputUniform` (mouse trails, fluids, diffusion, and so on). The library
takes care of RT allocation, per-frame driving, and disposal.
Returns a [`FeedbackBuffer`](/en/guide/post-effects#feedback-buffers-generators).

The colorNode graph is fixed at construction time, so **you must declare the output `texture()` node
in advance in the `options.uniforms` of `createPlane`, with the same name as `outputUniform`**
(otherwise it throws).

```ts
import { TSL } from 'dom-sync-gl';
const { texture, uniform, vec3, vec4 } = TSL;

const uTrailTex = texture(); // declare the output node in advance
const plane = app.createPlane('.card', {
  uniforms: { uTrailTex },
  colorNode: () => vec4(vec3(uTrailTex.r), 1),
});

plane.addFeedback({
  outputNode: trailNode, // TSL factory that reads uPrev/uMouse/uHover and accumulates a trail
  size: 256,
  outputUniform: 'uTrailTex',
  uniforms: { uDecay: uniform(0.94), uRadius: uniform(0.2) },
});
```

`addEffect` (a post that processes an image) and `addFeedback` (a generator that produces a material
texture) work in **opposite directions**.
See [Post Effects / Feedback buffers](/en/guide/post-effects#feedback-buffers-generators).

### `setTexture(texture, takeOwnership?)`

Replaces the `.value` of the internal `uTexture` (`TextureNode`). A texture passed with
`takeOwnership: true` is disposed on `destroy()`.

### `reloadTexture()`

Re-reads the `data-texture` attribute and applies it to the material. Useful when an SPA swaps the image URL.

### `getMouseUV()` / `isHovered()`

The latest plane-local UV and hover state.

### `setHoverInfo(isHovered, uv)`

Internal API that DomSyncGL uses to push raycast results. You normally do not touch it.

### `getMesh()`

The THREE.Mesh itself, for tweaking shadows, layers, and so on directly.

### `resize()`

Recomputes the DOM size and updates the nodes and scale. Called automatically when DomSyncGL resizes.

### `destroy()`

Releases the geometry, material, observer, planeComposer, and any texture it loaded itself.

## Texture via attribute

```html
<div class="card" data-texture="/img/photo.jpg"></div>
```

```ts
// Without colorNode, the texture is shown as-is
app.createPlane('.card');

// In your own colorNode, reference ctx.uTexture
app.createPlane('.card', {
  colorNode: ({ uTexture }) => uTexture, // sampled with uv() as-is
});
```

If the element has a `data-texture` attribute, it is loaded automatically with `THREE.TextureLoader`
and fed to the `uTexture` node. To read it with a different UV, use `uTexture.sample(customUv)`.

## setupGUI

A hook that builds per-plane lil-gui controls. It is called only when a gui instance is passed with
`new DomSyncGL(el, { gui })` (otherwise it is not called, and specifying it is harmless).
It has the same shape as `setupGUI` in `addEffect` / `addFeedback`, with the target (here, the plane)
passed as the second argument.

The `GUI` folder you return is **owned by the plane and destroyed automatically on `destroy()`**
(`BaseEffect` and `FeedbackBuffer` own their folders, but there is no corresponding object for a plane's
`setupGUI`, so the plane takes care of it). You do not need to destroy it yourself.

```ts
const sticker = new StickerPeel();
const plane = app.createPlane('.sticker', {
  ...sticker.planeOptions(), // planeOptions() returns options including setupGUI
});
```

## textureColorSpace

The color space of textures loaded from `data-texture`. The default is **`SRGBColorSpace`**.

They are decoded to linear when sampled and re-encoded to sRGB on output, so the colors match an
`<img>` in the DOM (NodeMaterial converts color spaces automatically on output, so the default changed
from v0.3's `NoColorSpace`, which assumed raw values were passed through). Specify `NoColorSpace` only
when you want raw values, such as for data textures.

```ts
app.createPlane('.card', {
  textureColorSpace: THREE.NoColorSpace, // the old behavior (raw values passed through)
});
```
