# DomTextPlane

A class that rasterizes the text of a DOM element to a canvas and puts it on a plane locked to that
element. It extends `DomPlane`, so `addEffect()` / `isHovered()` / `getMesh()` and the rest are the
same as in [DomPlane](/en/api/dom-plane).

Returned by `app.createTextPlane(selector, options?)`. It is not meant to be created directly.

```ts
const plane = app.createTextPlane('.headline', {
  updateRectEveryFrame: true,
});
```

## What the class does

1. Reads font-size / font-family / color / line-height / letter-spacing / text-align / padding
   from `getComputedStyle(element)`
2. Pours the text into a hidden mirror element and **lets the browser itself decide the line breaks**
3. Draws `element.textContent` to a 2D canvas with those values
4. Puts the canvas on the plane as a `CanvasTexture`
5. Hides the original DOM text only visually with `color: transparent`

::: tip Why not display: none
It uses `color: transparent` instead of `visibility` / `display` / `opacity`, so that layout,
accessibility, SEO, and text selection all stay on the DOM side while only the visuals are replaced by
WebGL. Screen readers still read it as normal text.
:::

::: warning CSS decides size and color
Styles always come from `getComputedStyle`, so fluid values such as `font-size: clamp(...)` are
resolved as-is. You do not need to copy breakpoints into JS. Conversely, to change how the plane
looks, you edit the CSS, not the JS.
:::

## Options

`CreateTextPlaneOptions` extends [`CreatePlaneOptions`](/en/api/dom-plane#createplaneoptions) with the following.

| option | type | default | description |
|---|---|---|---|
| `text` | `string` | `element.textContent` | Text to render instead |
| `style` | `TextStyleOverrides` | `{}` | Overrides individual values extracted from `getComputedStyle` |
| `pixelRatio` | `number` | `min(devicePixelRatio, 2)` | Resolution multiplier of the canvas |
| `hideElementText` | `boolean` | `true` | Whether to hide the original DOM text with `color: transparent` |

Without `colorNode`, the text canvas is drawn as-is as `uTexture`.
In your own `colorNode`, reference the text texture with `ctx.uTexture`.

### `TextStyleOverrides`

You can override `fontSize` / `fontFamily` / `fontWeight` / `fontStyle` / `color` / `lineHeight` /
`letterSpacing` / `textAlign` / `padding` / `paddingTop` / `paddingRight` /
`paddingBottom` / `paddingLeft` / `verticalAlign` individually.
Anything you do not specify comes from CSS.

```ts
app.createTextPlane('.headline', {
  style: { color: '#ff0000', letterSpacing: 2 },
});
```

## Padding

The element's `padding` is read from `getComputedStyle` and carries over as the text's padding.
The plane itself comes from `getBoundingClientRect()`, so it covers the whole border-box including the
padding, and the content area sits inside it.

| padding | Effect |
|---|---|
| `padding-left` / `padding-right` | Applied to the wrapping width (content width) and to the drawing start x according to `text-align` |
| `padding-top` | The reference for the top of the text block |
| `padding-bottom` | Sets the bottom of the content area. Takes effect when `verticalAlign` is not `top` |

To override it from JS, use `style`. `padding` sets all four sides at once; when combined with
individual sides, the individual values win, as in CSS.

```ts
// Ignore the CSS padding and draw over the whole plane
app.createTextPlane('.headline', { style: { padding: 0 } });

// Widen only the left side (top, bottom, and right come from CSS)
app.createTextPlane('.headline', { style: { paddingLeft: 80 } });
```

### `verticalAlign`

Vertical alignment of the text block within the content area (the element height minus
`padding-top` / `padding-bottom`). Its CSS counterpart is `align-content`: `center` resolves to
`center`, `end` / `flex-end` to `bottom`, and anything else (`normal` or unsupported environments) to
`top`. You can override it explicitly with `style.verticalAlign`.

```ts
app.createTextPlane('.button-label', { style: { verticalAlign: 'center' } });
```

::: warning Overflow is not clipped
Even when the text does not fit in the content area, its position is not clamped and it is drawn
as-is (like CSS `overflow: visible`). With a large `padding-bottom` and more lines, the text runs
through the padding, so adjust the element height or `line-height` to make it fit.
:::

::: tip Why align-content instead of vertical-align
`vertical-align` controls alignment within inline boxes and does not affect vertical placement of a
block. The current CSS property for vertical alignment in a block container is `align-content`, so
that is what is read.
:::

## Instance members

In addition to the `DomPlane` members:

| member | type | description |
|---|---|---|
| `rasterize()` | `void` | Redraws the canvas and updates the texture |
| `setText(text)` | `void` | Replaces the text (also updates the DOM `textContent` and redraws) |

`resize()` / `destroy()` are overridden: when the element size changes, the internal
`ResizeObserver` re-rasterizes automatically. `destroy()` restores the `color` of the hidden text.

## How text is handled

- `\n` is respected as a paragraph break
- Consecutive whitespace within each paragraph is normalized to a single space, and leading and trailing whitespace is trimmed
- Each paragraph wraps at the element width (the area excluding padding). **The browser decides the line breaks** (see below)
- Canvas sides are clamped to 4096px (so huge elements × high DPR do not exhaust VRAM)

### Line breaks match the DOM

The 2D canvas has no API for line breaking. A custom "split on spaces and wrap by width"
implementation would split evenly by character for languages without spaces such as Japanese, and
could not apply line-breaking rules (such as keeping `。` and `、` from starting a line), so it would
differ from how the DOM looks.

Instead, the text is poured with the same letter spacing into a hidden mirror element placed off
screen, and the **line boxes the browser actually laid out** are read with `Range.getClientRects()`
and drawn exactly that way. UAX #14 break rules, line-breaking rules, and unbroken English words all
come straight from the browser's implementation.

The element's `word-break` / `overflow-wrap` / `line-break` are also copied from the computed style to
the mirror, so if you control wrapping with CSS, the plane follows the same way.

::: tip Environments without layout
In environments without line boxes, such as SSR or jsdom, no rectangles can be read, so it
automatically switches to a custom implementation (`layoutLines()`) that splits on spaces with a
per-character fallback. This does not affect rendering in browsers.
:::

::: warning The vertical position of lines differs slightly
Line breaks match, but the vertical position of lines is based on the canvas `textBaseline: middle`,
so it does not exactly match the DOM's half-leading (how glyphs are placed within the line box). The
difference is visible when DOM text and GL text are displayed on top of each other.
:::

::: warning Line breaks in the HTML become paragraphs
The `textContent` is used as-is, so line breaks from HTML indentation are also treated as paragraph
breaks. If unintended empty lines appear, write the element's text on one line or pass it explicitly
with the `text` option.

```html
<!-- This adds empty paragraphs before and after -->
<p class="headline">
  Hello
</p>

<!-- Write it like this -->
<p class="headline">Hello</p>
```
:::

## Waiting for fonts

The first rasterization waits for `document.fonts.ready` (so it does not bake the text with a font
from before the web font is applied). If the page fonts are already loaded, it draws without waiting.

To load arbitrary web fonts dynamically, use [`loadFont()`](/en/api/load-font) and call
`createTextPlane()` **after it resolves**.
