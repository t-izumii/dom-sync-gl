# loadFont

A standalone utility that loads any web font with the FontFace API and registers it in `document.fonts`.

```ts
import { loadFont } from 'dom-sync-gl';

await loadFont({
  family: 'SpaceMono',
  url: '/fonts/space-mono-400.woff2',
  weight: '400',
  style: 'normal',
});
```

## Separate from `DomTextPlane`

Fetching and registering fonts is not the job of `DomTextPlane`. `loadFont()` simply adds fonts to
`document.fonts`, and `createTextPlane()` still only reads styles from `getComputedStyle`.

Thanks to this separation, font-size and font-weight are always decided by CSS (including fluid
`clamp()` values).

```css
.headline {
  font-family: "SpaceMono", ui-monospace, monospace;
  font-size: clamp(1.2rem, 3vw, 2.2rem);
}
```

```ts
// 1. Fetch (cache the Promise in a variable)
const spaceMonoReady = loadFont({
  family: 'SpaceMono',
  url: '/fonts/space-mono-400.woff2',
});

// 2. Use (create the plane after waiting)
spaceMonoReady.then(() => {
  app.createTextPlane('.headline');
});
```

::: tip Keep the Promise in a variable
`loadFont()` itself has an internal cache that prevents fetching the same font twice, but the cache
key depends on the call arguments matching. If you use the same font in several places, the reliable
way is to call it once as above, keep the Promise in a variable, and await it wherever it is used.
:::

## Signature

```ts
function loadFont(source: FontFaceSource | FontFaceSource[]): Promise<void>
```

Accepts a single source or an array. With an array, all fonts load in parallel and it resolves when all of them finish.

### `FontFaceSource`

| field | type | description |
|---|---|---|
| `family` | `string` | The name used in the CSS `font-family` |
| `url` | `string` | URL of the font file. Either a single URL or CSS `url()` / `local()` syntax |
| `weight` | `string` | `font-weight` (e.g. `'400'`, `'700'`, `'400 700'`) |
| `style` | `string` | `font-style` (e.g. `'normal'`, `'italic'`) |
| `descriptors` | `FontFaceDescriptors` | Other descriptors (`unicode-range`, etc.) |

`weight` / `style` are merged into `descriptors` (`descriptors` takes precedence).

## Error handling

**It never rejects on failure.** It logs a `console.warn` and resolves, so callers do not need to
write a `catch` every time.

```ts
// Execution always reaches this line even if the font fails. The CSS fallback is used.
await loadFont({ family: 'SpaceMono', url: 'https://example.com/dead.woff2' });
app.createTextPlane('.headline');
```

- In environments without `FontFace` / `document.fonts`, it does nothing and resolves immediately
- Fonts that load successfully stay in the cache and are never fetched again
- Fonts that fail are removed from the cache and retried on the next call (to recover from temporary
  network errors)

## Low-level APIs

If you want to rasterize text yourself, the functions used internally are exported as well.

```ts
import { resolveTextStyle, layoutLines, rasterizeText } from 'dom-sync-gl';
import type { ResolvedTextStyle } from 'dom-sync-gl';

// Resolves font / color / padding and so on from getComputedStyle
resolveTextStyle(el: HTMLElement, overrides?: TextStyleOverrides): ResolvedTextStyle

// Wraps text at maxWidth into an array of lines. measure returns the width of a string
layoutLines(text: string, maxWidth: number, measure: (s: string) => number): string[]

// Draws text to a canvas. Returns true if it drew anything
rasterizeText(
  canvas: HTMLCanvasElement,
  text: string,
  style: ResolvedTextStyle,
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
): boolean
```

When a side exceeds 4096px, `rasterizeText()` lowers `pixelRatio` automatically to clamp it.
