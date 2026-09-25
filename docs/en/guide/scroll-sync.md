# Scroll Sync

A layer that keeps the native `window.scrollY` and the canvas rendering position in sync.

## Enabling it

```ts
const app = new DomSyncGL('#canvas', {
  scrollSync: true,
});
```

With `scrollSync: true`, the container is attached to the document with `position: absolute`, and the
effective scrollY is applied to its transform on every rAF so it follows the viewport.

## Effective scrollY and the iOS Safari rubber-band effect

The effective scrollY is `-document.documentElement.getBoundingClientRect().top`.
It normally equals `window.scrollY`, but during the rubber-band effect and pull-to-refresh at the top
of iOS Safari it includes the visual viewport offset and goes negative. The same value drives both the
container transform and the plane positions, so the canvas and the DOM shift by the same amount during
the rubber-band effect, and pull-to-refresh keeps working.

## Options

```ts
new DomSyncGL('#canvas', {
  scrollSync: { trackStrength: true },
});
```

| option | type | default | description |
|---|---|---|---|
| `trackStrength` | `boolean` | `false` | Enables tracking of `strength` (scroll velocity) |
| `strengthDecay` | `number` | `10` | Exponential decay factor of strength |
| `overscan` | `number \| 'auto' \| false` | `'auto'` | Extends the canvas above and below the viewport, in px |
| `attach` | `'translate' \| 'dom'` | `'translate'` | How the container is attached. `'dom'` keeps the container's own CSS placement |

See [API: Scroll](/en/api/scroll) for details on each option.

## Mobile URL bar protection is on by default

`overscan` defaults to `'auto'`, which extends the canvas by `viewportHeight * 0.25` above and below
only on `(pointer: coarse)` devices. This prevents the canvas edges from appearing cut off when the
mobile URL bar resizes the viewport. With a mouse it is `0`, so nothing is wasted.

In other words, you do not need to specify anything. Set it only to turn it off.

```ts
new DomSyncGL('#canvas', {
  scrollSync: { overscan: false },
});
```

## Keeping the container's CSS with `attach: 'dom'`

The default `'translate'` turns the container into a viewport-sized overlay and follows the viewport
with a translate on every tick. With `'dom'`, ScrollSync never overrides the container's position,
size, or transform and keeps its own CSS placement. The canvas appears in the container's box.

- If the container is `position: fixed`, the canvas behaves like a fixed element (the browser handles following the viewport).
- If the container is in normal flow, the canvas is created at the container's size.

`overscan` is ignored in `'dom'` mode.

## Stopping rendering off screen

With `attach: 'dom'`, the canvas keeps the container's CSS placement, so scrolling **actually moves it
out of the viewport**. Pass `pauseWhenOffscreen: true` to release the rAF loop during that time and stop
rendering, DOM reads, and effect computation together.

```ts
new DomSyncGL('#canvas', {
  scrollSync: { attach: 'dom' },
  pauseWhenOffscreen: true,
});
```

It is ignored with the default `'translate'` (with a warning in DEV). In translate mode the container
is re-attached to the viewport on every tick, so it never goes off screen, and conversely **the loop
itself is what keeps the container attached to the viewport**, so it cannot be stopped. It also does
not apply without scrollSync.

Visibility is detected by an IntersectionObserver on the container, with a default `rootMargin` of
`'100%'` (the loop starts again one viewport ahead). You can change it with `pauseRootMargin`, but
IntersectionObserver notifications are delivered **after** rAF callbacks, so resuming is at least one
frame late. Narrowing it to `'0px'` exposes an unrendered frame right after resuming, so keeping the
generous default is recommended.

On resume, the differences from the previous frame that the pause would otherwise break are stitched back together:

- **Time** — `uTime` does not jump by the paused duration and continues from where it stopped
- **Scroll velocity** — prevents `strength` from sticking at 1 and flashing on the first frame after resuming
- **Pointer** — prevents `getMouseDelta()` from returning the whole movement made during the pause

When combined with `autoRaf: false`, `tick()` is a no-op while paused. Your own rAF does not stop, so
if you also want to skip your own per-frame work, check [`isPaused()`](/en/api/dom-sync-gl#ispaused).

Other behavior:

- A container with size 0 or `display: none` is also treated as "not intersecting" and pauses
- Right after construction, the loop runs for 0–1 frames until the first IntersectionObserver
  notification arrives (the first render warms up shader compilation, which reduces hitches on resume)
- Resizes are applied while paused, but nothing is redrawn until resuming
- OrbitControls damping and autoRotate also stop while paused
- In environments without IntersectionObserver, nothing is observed and the loop keeps running as before
- Hidden tabs (`document.hidden`) are not handled; only off-screen detection is

## Using scroll velocity in effects

With `trackStrength: true`, you can read `strength` (0–1). It approaches 1 the faster you scroll and
decays exponentially back to 0 according to `strengthDecay` when you stop.

```ts
import { TSL } from 'dom-sync-gl';
const { uniform, vec3, vec4 } = TSL;

const app = new DomSyncGL('#canvas', {
  scrollSync: { trackStrength: true },
});
const scrollSync = app.getScrollSync();

// Keep your own uniform node referenced by colorNode, and update its value every frame
const uStrength = uniform(0);
const plane = app.createPlane('.card', {
  uniforms: { uStrength },
  colorNode: () => vec4(vec3(uStrength), 1), // whiter the faster you scroll
});

app.addUpdateCallback(() => {
  uStrength.value = scrollSync.strength;
});
```

::: warning Without trackStrength it is always 0
The default is `false`, and then `strength` always returns `0` (with a one-time warning in DEV).
:::

## Smooth scrolling (Lenis)

The library does not include Lenis. Smooth scrolling is an application concern, so add it yourself.

```bash
npm install lenis
```

The key is to **turn off the built-in rAF of both Lenis and the core, and drive them in order from a single loop**.

```ts
import { DomSyncGL } from 'dom-sync-gl';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

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

"Settle the scroll → place WebGL" then always happens in the same frame and in the same order, so
neither fixed backgrounds nor DOM-following planes drift.

::: warning Do not split it into two rAF loops
If you leave `autoRaf: true` on both, Lenis and the core run **separate rAF loops**. Browsers run rAF
callbacks in registration order, so if the core registers first it reads a scrollY that is one frame
old, and the background canvas drifts while scrolling. A single loop guarantees the order regardless
of registration.

The former `rafScroll` option (where the core wrapped Lenis) was removed as part of this change.
:::

### Pull-to-refresh keeps working

By default Lenis leaves touch input native (`syncTouch: false`), so pull-to-refresh and edge bouncing
on mobile keep working. Set `syncTouch: true` if you also want to smooth touch input.

See the [Lenis documentation](https://github.com/darkroomengineering/lenis#instance-settings) for other options.

## Demo

→ A working sample and code are in [Demos / Scroll Sync](/en/demos/scroll-sync).
