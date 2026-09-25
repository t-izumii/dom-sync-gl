# DOM-locked Plane

An example that runs your own TSL shader on a Three.js plane following the bounding box of a DOM
element. The color reacts on hover.

## Demo

<DemoPlane />

## HTML

Prepare one container that holds WebGL (`stage`) and one element the plane sticks to (`card`).

```html
<div id="stage" style="position: relative; height: 320px; overflow: hidden;">
  <div
    id="card"
    style="
      position: absolute;
      left: 50%;
      top: 50%;
      width: 60%;
      max-width: 360px;
      aspect-ratio: 16 / 9;
      transform: translate(-50%, -50%);
      border-radius: 12px;
    "
  ></div>
</div>
```

::: tip The stage needs a position
The plane from `createPlane()` looks at `card.getBoundingClientRect()` internally, so the card must be
placed properly in the center of the stage. If you forget `position: relative` on the stage, the
absolutely positioned card escapes to an ancestor and the plane locks to the wrong place.
:::

## TypeScript

```ts
import { DomSyncGL, TSL } from 'dom-sync-gl';
const { vec2, vec3, vec4, sin, mix, distance, select } = TSL;

const app = new DomSyncGL('#stage');

app.createPlane('#card', {
  colorNode: ({ uv, uTime, uMouseUV, uIsHovered }) => {
    const hovered = uIsHovered.greaterThan(0.5);
    const dist = distance(uv, select(hovered, uMouseUV, vec2(0.5)));
    const ring = sin(dist.mul(12).sub(uTime.mul(1.5))).mul(0.5).add(0.5);
    const col = mix(vec3(0.34, 0.43, 0.99), vec3(0.96, 0.34, 0.62), uv.y)
      .add(ring.mul(0.18));
    return vec4(mix(col, vec3(1), uIsHovered.mul(0.15)), 1);
  },
});
```

## Notes

### 1. Built-in nodes you can use without declaring them

`uTime` `uMouseUV` `uIsHovered` `uResolution` `uTexture` `uAlpha` `uv` are available from the argument
(ctx) of `colorNode`. DomSyncGL updates their values.
See [API: DomPlane](/en/api/dom-plane#planenodecontext-built-in-nodes) for details.

### 2. `uIsHovered` is a float (0 / 1)

In TSL, use `select(cond, a, b)` for conditionals. `uIsHovered` is a float, so use
`uIsHovered.greaterThan(0.5)` as a boolean, or `uIsHovered.mul(x)` directly as an intensity.

### 3. Hover detection is raycast-driven

`uIsHovered` is updated by DomSyncGL's internal raycaster from the mouse position on the canvas.
It does not depend on the element's `pointer-events` in the DOM (the plane lives in the 3D scene).

### 4. Destroying planes

When unmounting planes in an SPA, always call `app.destroy()`.
The geometry, material, and observers are all released.

```ts
onBeforeUnmount(() => app.destroy());
```
