# Text Planes

A layer that puts text under WebGL control as well. It renders DOM text to a canvas and puts it on a
plane locked to that element.

## Usage

```html
<p class="headline">Hello, WebGL.</p>
```

```ts
const plane = app.createTextPlane('.headline', {
  updateRectEveryFrame: true,
});
```

That is all it takes for the text of `.headline` to become a plane drawn by WebGL. Its position and
size follow the DOM, just like `createPlane()`.

## The DOM stays

The original text only becomes `color: transparent` and stays in the DOM.

- Layout is still decided by the DOM
- Screen readers read it as normal text
- Text selection, search, and SEO keep working

The idea is to replace only the visuals with WebGL. It does not use `display: none` or `opacity: 0`.

## CSS decides the style

font-size / font-family / color / line-height / letter-spacing / text-align / padding /
align-content are all read from `getComputedStyle`. That means **fluid values such as `clamp()` are
resolved as-is**.

```css
.headline {
  font-family: "Zen Old Mincho", serif;
  font-size: clamp(1.4rem, 3.4vw, 2.6rem);  /* applied to the plane as-is */
  line-height: 1.6;
  padding: 2rem 3rem;                       /* the padding carries over to the plane too */
}
```

`padding` carries over as the inner margin of the plane. Horizontal padding sets the wrapping width and
where drawing starts, and vertical padding sets the reference for placing the text block (see
[DomTextPlane padding](/en/api/dom-text-plane#padding)).

You do not need to copy breakpoints into JS; to change how the plane looks, you edit the CSS.
Use the `style` option only when you want to override individual values.

```ts
app.createTextPlane('.headline', {
  style: { color: '#ff0000', padding: 0 },
});
```

## Loading web fonts dynamically

Fetching and registering fonts is not the job of `DomTextPlane` but of the separate
[`loadFont()`](/en/api/load-font). **Keep fetching and using separate, and create the plane after it resolves.**

```ts
import { loadFont } from 'dom-sync-gl';

// 1. Fetch (cache the Promise in a variable)
const spaceMonoReady = loadFont({
  family: 'SpaceMono',
  url: '/fonts/space-mono-400.woff2',
  weight: '400',
});

// 2. Use (create after waiting)
spaceMonoReady.then(() => {
  app.createTextPlane('.headline');
});
```

```css
.headline {
  font-family: "SpaceMono", ui-monospace, monospace;
}
```

`loadFont()` never rejects on failure and only warns, so if a font fails to load, the page does not
break and the CSS fallback is used.

::: tip What happens if you do not wait
`createTextPlane()` waits for `document.fonts.ready` before the first rasterization, so fonts
**declared with `@font-face` in the page CSS** render correctly without waiting. You only need to wait
for `loadFont()` when adding fonts dynamically **after** `document.fonts.ready` has already resolved.
:::

## Adding per-plane effects

`DomTextPlane` is a subclass of `DomPlane`, so `addEffect()` works as-is.
Hover is detected by `PointerController` with a raycast, so you do not need `pointerenter` on the DOM.

```ts
const plane = app.createTextPlane('.headline');
const hover = new TextHoverEffect();
plane.addEffect(hover);

let v = 0;
app.addUpdateCallback(() => {
  v += ((plane.isHovered() ? 1 : 0) - v) * 0.15;
  hover.setHover(v);
});
```

## The browser decides line breaks too

Wrapping is not computed by the library. It pours the text into a hidden off-screen element, reads
the line boxes the browser actually laid out with `Range.getClientRects()`, and draws exactly those.

For languages without spaces such as Japanese, a custom implementation would split evenly by character
and could not apply line-breaking rules (a `。` would land at the start of a line, for example). By
leaving it to the browser, UAX #14 break rules, line-breaking rules, unbroken English words, and the CSS
`word-break` / `overflow-wrap` / `line-break` settings are all reflected on the plane as-is. See
[DomTextPlane](/en/api/dom-text-plane#line-breaks-match-the-dom) for details.

## Pitfalls

### Line breaks in the HTML become paragraphs

The `textContent` is rendered as-is, so line breaks from indentation also become paragraph breaks.

```html
<!-- Empty paragraphs are added before and after -->
<p class="headline">
  Hello
</p>

<!-- Write it like this -->
<p class="headline">Hello</p>
```

### DOM opacity does not affect the plane

If you set `opacity: 0` on the DOM for a reveal animation, the plane keeps being drawn by WebGL.
You end up with "transparent DOM, visible GL text", so to fade in, animate a uniform of the plane or
do not turn it into a plane at all.

## Next steps

- [API: DomTextPlane](/en/api/dom-text-plane) — all options and members
- [API: loadFont](/en/api/load-font) — font loading and low-level APIs
