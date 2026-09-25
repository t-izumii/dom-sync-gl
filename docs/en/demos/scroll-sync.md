# Scroll Sync

An example where DOM elements and planes stay aligned while scrolling.
Instead of scrolling the whole document, it shows the behavior with a local overflow scroll.

## Demo

Use the ▲ / ▼ buttons to simulate scrolling. The planes stay locked to the positions of the three cards.

<DemoScrollSync />

## HTML

```html
<div id="stage" style="position: relative; height: 360px; overflow: hidden;">
  <div
    id="scroller"
    style="position: absolute; inset: 0; overflow-y: auto;"
  >
    <div style="display: grid; gap: 24px; padding: 40px 16px;">
      <div data-card="0" style="height: 140px; border-radius: 12px;"></div>
      <div data-card="1" style="height: 140px; border-radius: 12px;"></div>
      <div data-card="2" style="height: 140px; border-radius: 12px;"></div>
    </div>
  </div>
</div>
```

## TypeScript

```ts
import { DomSyncGL, TSL } from 'dom-sync-gl';
const { vec3, vec4, sin } = TSL;

const app = new DomSyncGL('#stage');

// Put a plane with a different color on each card
const colors: [number, number, number][] = [
  [0.34, 0.43, 0.99],
  [0.96, 0.34, 0.62],
  [0.27, 0.83, 0.58],
];

for (let i = 0; i < 3; i++) {
  app.createPlane(`[data-card="${i}"]`, {
    updateRectEveryFrame: true,
    colorNode: ({ uv, uTime }) => {
      const g = sin(uTime.add(uv.x.mul(6))).mul(0.5).add(0.5);
      return vec4(vec3(...colors[i]).mul(g.mul(0.4).add(0.6)), 1);
    },
  });
}
```

## Notes

### 1. Why `updateRectEveryFrame: true` is needed

A plane normally caches the `getBoundingClientRect()` it measured first. When the element itself moves
within the DOM (its position changes inside a parent scroller as in this demo, or its transform changes
with GSAP / CSS animations), the rect must be re-measured every frame, or the plane is left behind at
the old position.

If you only need to follow the visual movement caused by window scrolling, you can keep
`updateRectEveryFrame: false` (the plane's scene position is computed from the scroll snapshot).

### 2. Using it with window scrolling

For scrolling of the whole `window`, pass `scrollSync: true`:

```ts
const app = new DomSyncGL('#stage', { scrollSync: true });
```

The container is attached to the document with `position: absolute`, and the effective scrollY is
applied to its transform on every rAF so it follows the viewport. It does not break the rubber-band
effect or pull-to-refresh on iOS Safari (see [Guide: Scroll Sync](/en/guide/scroll-sync) for details).

### 3. A single rAF loop with Lenis aligns things even better

When you add smooth scrolling, turn off the built-in rAF of both Lenis and the core, and drive them in
order from a single loop. The values JS reads and the painted positions line up within the frame, so
the one-frame offset between planes and the DOM disappears:

```ts
import Lenis from 'lenis';

const lenis = new Lenis({ autoRaf: false });
const app = new DomSyncGL('#stage', { scrollSync: true, autoRaf: false });

const raf = (time: number) => {
  lenis.raf(time);   // settle the scroll position first,
  app.tick(time);    // then place WebGL using the settled value
  requestAnimationFrame(raf);
};
requestAnimationFrame(raf);
```

See the [Scroll Sync guide](/en/guide/scroll-sync#smooth-scrolling-lenis) for details.
