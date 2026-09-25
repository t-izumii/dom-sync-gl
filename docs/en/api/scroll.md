# Scroll

Scrolling is handled by a single class, `ScrollSync`.

| Class | Role |
|---|---|
| `ScrollSync` | Attaches the container to the document with `position: absolute` and makes it follow the viewport on every tick |

::: warning RafScroll was removed
The former `RafScroll` (a Lenis wrapper) has been removed. Smooth scrolling is **an application
concern** and not something the library should own. To use Lenis, follow
[Using it with Lenis](#using-it-with-lenis). The `rafScroll` option and `getRafScroll()` are gone as well.
:::

## ScrollSync

Normally used through `new DomSyncGL(..., { scrollSync: true })`. You can also create it directly.

### Options

| option | type | default | description |
|---|---|---|---|
| `trackStrength` | `boolean` | `false` | Enables tracking of `strength` (scroll velocity) |
| `strengthDecay` | `number` | `10` | Exponential decay factor of strength. Larger values return to 0 faster |
| `overscan` | `number \| 'auto' \| false` | `'auto'` | Extends the canvas above and below the viewport, in px |
| `attach` | `'translate' \| 'dom'` | `'translate'` | How the container is attached. `'dom'` keeps the container's own CSS placement |

#### `overscan`

Sets the canvas height to `viewportHeight + 2 * overscan` and shifts it up by `overscan`. This margin
prevents the canvas edges from appearing cut off when the mobile URL bar resizes the viewport.

The default `'auto'` reserves `viewportHeight * 0.25` only on `(pointer: coarse)` devices and `0`
(no overhead) with a mouse. In other words, **if you specify nothing, touch devices get the protection
and desktops waste nothing**.

A number uses that many pixels regardless of the pointer type. To remove the margin entirely, pass `false` (or `0`).

```ts
// The default; same as not specifying it
new DomSyncGL('#canvas', { scrollSync: true });

// Always reserve 200px
new DomSyncGL('#canvas', { scrollSync: { overscan: 200 } });

// Opt out of the margin
new DomSyncGL('#canvas', { scrollSync: { overscan: false } });
```

In environments without `window.matchMedia` (SSR / old browsers), `'auto'` falls back to `0`.

#### `attach`

`'translate'` (the default) makes the container `position: absolute` and applies
`translate3d(scrollX, effectiveScrollY, 0)` on every tick.

`'dom'` keeps the container's CSS placement and never overrides its position, size, or transform.
If the container is `position: fixed`, the canvas behaves like a fixed element; in normal flow, the
canvas is created at the container's own size. `overscan` is not applied. A container in normal flow
moves the canvas itself when scrolling, but the canvas position is re-measured every frame, so planes
do not drift (the same applies when sticky positioning or CSS transforms move the container).

Combined with `'dom'`, you can use [`pauseWhenOffscreen`](/en/api/dom-sync-gl#options), which stops
the render loop while the canvas is off screen.

### static `ScrollSync.computeEffectiveScrollY()`

Returns `-document.documentElement.getBoundingClientRect().top`. It normally equals `window.scrollY`,
but during the rubber-band effect at the top of iOS Safari it includes the visual viewport offset and goes negative.

### Instance members

| member | type | description |
|---|---|---|
| `logicalRect` | `DOMRect` (getter) | Logical rect of the canvas. `(0, 0, vw, vh)` with `overscan: 0` |
| `strength` | `number` (getter) | Scroll velocity (0–1). Always 0 with `trackStrength: false` |
| `enabled` | `boolean` (getter/setter) | With `false`, `update()` becomes a no-op and transform updates stop |
| `update(scrollX, scrollY)` | `void` | Call on every tick. **Pass the same effectiveScrollY as the planes** |
| `updateSize(width?, height?)` | `void` | Call when the viewport size changes |
| `destroy()` | `void` | Restores the container's inline styles to their values before construction |

Normally you use it through `DomSyncGL(..., { scrollSync: true })`, and the core calls `update`,
`updateSize`, and `destroy` automatically. Wire them up yourself only if you create `new ScrollSync()` directly.

::: tip strength needs trackStrength
Reading `strength` with `trackStrength: false` (the default) always returns `0`. DEV builds warn once
with `console.warn`. If you use it in effects, always set `{ trackStrength: true }`.
:::

## Using it with Lenis

The library does not include Lenis. To add smooth scrolling, create Lenis in your application and
**drive `lenis.raf()` → `app.tick()` in that order from a single rAF**.

```bash
npm install lenis
```

```ts
import { DomSyncGL } from 'dom-sync-gl';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

// Neither should run its own rAF
const lenis = new Lenis({ autoRaf: false });
const app = new DomSyncGL('#canvas', {
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

::: warning Do not split it into two rAF loops
If you leave `autoRaf: true` on both, Lenis and the core run **separate rAF loops**. Browsers run rAF
callbacks in registration order, so if the core registers first it reads a scrollY that is one frame
old, and the background canvas drifts while scrolling. A single loop as above guarantees the order
regardless of registration.
:::

See the [Lenis documentation](https://github.com/darkroomengineering/lenis#instance-settings) for
Lenis options (`lerp` / `duration` / `smoothWheel` / `syncTouch` and so on).
Touch input stays native by default (`syncTouch: false`), so pull-to-refresh keeps working.
