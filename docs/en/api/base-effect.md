# BaseEffect

The base class for post effects. Return a TSL `outputNode` factory and uniforms from `getConfig()`, and
it joins the chain through `addEffect()`.

## Minimal example

```ts
import { BaseEffect, type BaseEffectConfig, THREE, TSL } from "dom-sync-gl";
const { uniform, vec4, mix } = TSL;

class TintEffect extends BaseEffect {
  private uColor = uniform(new THREE.Color("#ff66aa"));

  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: ({ inputTexture }) =>
        vec4(mix(inputTexture.rgb, this.uColor, 0.3), inputTexture.a),
      uniforms: { uColor: this.uColor },
    };
  }
}
```

The result of the previous pass arrives as `ctx.inputTexture` (a `TextureNode`). Used as-is, it is
sampled with `uv()`; to read it with a different UV, use `ctx.inputTexture.sample(customUv)`. The
screen UV is passed as `ctx.uv`.

`outputNode` is called **only once**, when the pass is added. From then on, per-frame updates replace
the `.value` of the `UniformNode`s passed in `uniforms` (that is, `setUniform()`).

→ See the [migration guide](/en/guide/migration-v0-4) to rewrite v0.3 `fragmentShader` / `tDiffuse`.

## Built-in runtime state

Subclasses can reference these as `protected` members. The owner (the `DomSyncGL` / `DomPlane` you
called `addEffect()` on) updates them every frame and on every resize, so you do not need to provide them yourself.

| Member             | Type                   | Contents                                                                              |
| ------------------ | ---------------------- | ------------------------------------------------------------------------------------- |
| `uTime`            | `UniformNode<number>`  | Elapsed seconds                                                                       |
| `uMouse`           | `UniformNode<Vector2>` | Mouse UV. **Top-left origin** (same coordinate system as `ctx.uv`)                    |
| `uPrevMouse`       | `UniformNode<Vector2>` | Mouse UV of the previous frame, in the same coordinate system as `uMouse`. Equal to `uMouse` on the first frame |
| `uMove`            | `UniformNode<number>`  | Mouse movement intensity, normalized to 0–1, falling gradually to 0 when the mouse stops |
| `mouseMotion`      | `MouseMotion`          | The source of `uPrevMouse` / `uMove`. Holds the tuning knobs and the previous position |
| `width` / `height` | `number`               | The latest render size (CSS px)                                                       |

```ts
class RippleEffect extends BaseEffect {
  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: ({ inputTexture, uv }) => {
        const d = length(uv.sub(this.uMouse));
        // ...
      },
    };
  }
}
```

`uTime` / `uMouse` / `uPrevMouse` / `uMove` are already updated **just before** `update()` is called,
so you do not need to reassign them in `update()`. Likewise, `width` / `height` are updated just before
`resize()`. They are updated through internal APIs that the owner always calls, so forgetting to call
`super.update()` / `super.resize()` does not break them.

### `uMove` (mouse movement intensity gate)

The mouse movement since the previous frame, normalized to 0–1. Multiply brush or trail intensity by it
to draw "only while the mouse is moving".

```ts
outputNode: ({ inputTexture }) => {
  const glow = smoothstep(0.05, 0.0, length(uv().sub(this.uMouse)));
  return vec4(inputTexture.rgb.add(glow.mul(this.uMove)), inputTexture.a);
};
```

It is asymmetric: it rises **instantly** and decays **gradually**. If it did not react the moment the
mouse starts moving, input would feel laggy; if it disappeared the moment the mouse stops, the trail
would look cut off.

| `mouseMotion` knob | Default  | Contents                                                                           |
| ------------------ | -------- | ---------------------------------------------------------------------------------- |
| `threshold`        | `0.0008` | Movement at or below this distance is treated as 0 (removes hand shake and sub-pixel jitter) |
| `scale`            | `0.01`   | Movement of this distance reaches 1. Anything beyond is capped at 1                |
| `release`          | `0.85`   | Decay factor applied every frame while the mouse is still                          |

::: tip The same as `FeedbackContext.uMove` on planes
`uMove` / `uPrevMouse` in `plane.addFeedback()` and `PlaneNodeContext.uMove` / `uPrevMouse` in
`createPlane()` use the same `MouseMotion`, so all three paths feel the same. The knobs work the same way too.
:::

### `uPrevMouse` (mouse position in the previous frame)

Derive the movement vector, distance, and direction from its difference with `uMouse`.
On the first frame it equals `uMouse`, so you do not need your own "no previous value yet" flag (the
difference is naturally 0). From JS, read the same value with `this.mouseMotion.prev`.

```ts
outputNode: ({ inputTexture }) => {
  const delta = this.uMouse.sub(this.uPrevMouse); // movement vector of this frame
  // ...
};
```

::: tip There is no resolution uniform
If you need the resolution in a shader, use TSL's `screenSize` (updated automatically on every render,
with no initial dummy value or wiring needed). Note, however, that `screenSize` returns the size of
the "currently bound RenderTarget", so while rendering into your own small simulation grid it is the
grid size. `width` / `height` exist for cases that need **actual numbers on the JS side that TSL cannot
replace**, such as sizing `new THREE.RenderTarget(w, h)`.
:::

## Feedback buffers

For afterimage, trail, and simulation effects, you can declare an **accumulation buffer owned by the
effect** with `feedback` in `getConfig()`. `BaseEffect` takes care of the RenderTarget ping-pong pair,
the initial clear, per-frame rendering and swapping, resizing, and disposal, so subclasses only write
"the accumulation formula (a TSL node)".

```ts
class TrailEffect extends BaseEffect {
  protected getConfig(): BaseEffectConfig {
    return {
      feedback: {
        // prev = the accumulated value of the previous frame. Add this frame's contribution and return it
        node: ({ prev, uv }) => {
          const d = length(uv.sub(this.uMouse));
          const brush = smoothstep(0.05, 0.0, d);
          return vec4(prev.rgb.mul(0.95).add(brush), 1.0);
        },
      },
      // The accumulated result lives in an off-screen RT, so it only appears once composited with inputTexture
      outputNode: ({ inputTexture }) =>
        vec4(inputTexture.rgb.add(this.feedbackTexture.rgb), inputTexture.a),
    };
  }
}
```

| Member / option   | Contents                                                                             |
| ----------------- | ------------------------------------------------------------------------------------ |
| `feedbackTexture` | A `TextureNode` that reads the **latest result** of the accumulation buffer. Reference it from `outputNode` |
| `feedback.node`   | Factory returning the new accumulated value (vec4). Called **only once** on register |
| `feedback.size`   | `'screen'` (default / same resolution as the drawing buffer) or a number N (an N×N square) |
| `feedback.type`   | Default `THREE.HalfFloatType`                                                        |
| `feedback.filter` | Default `THREE.LinearFilter`                                                         |

::: warning Nothing appears on screen unless you composite it in `outputNode`
The accumulation buffer is an off-screen RenderTarget and is not added to the post effect chain
automatically. Nothing you draw is displayed until you composite `feedbackTexture` with `inputTexture`
in `outputNode` (add it, mix it, offset the UV, and so on).
:::

::: warning `feedback.node` cannot reference `inputTexture`
The accumulation buffer is rendered **before** the composer's `render()` (right after `update()`).
At that point `inputTexture` points to the previous frame's ping-pong target, which is about to be
overwritten, so reading it gives meaningless values. To mix in the previous pass, do it in
`outputNode` instead of `feedback.node`.
:::

The `uv` passed to `feedback.node` is the UV of the accumulation buffer, with the same **top-left
origin** as `ctx.uv` / `uMouse`. You can compare it with `uMouse` directly.

`feedback.node` is evaluated **right after** `update()`. Uniforms you update in `update()` (such as
values from the GUI) are reflected in the accumulation immediately.

::: tip Why HalfFloat is the default
With 8-bit (`UnsignedByteType`), repeating "previous frame × 0.95" rounds back up. Multiplying
10/255 by 0.95 gives 9.5/255, which rounds back to 10/255, leaving a "ghost" afterimage that never
disappears. For repeated decay, use HalfFloat or higher.
:::

::: tip `size: 'screen'` loses its contents on resize
When the canvas size changes, the RenderTarget is recreated, so the accumulated contents are discarded
and start again from a cleared buffer. To keep the contents across resizes, specify a number for
`size` to fix the resolution (it is then not recreated on resize).
:::

## Abstract / overridable

### `getConfig(): BaseEffectConfig` _(abstract)_

Returns the `outputNode` factory and uniforms.

```ts
interface BaseEffectConfig {
  outputNode: (ctx: EffectContext) => Node;
  uniforms?: Record<string, UniformNode<unknown>>;
  /** Declares an accumulation buffer (→ [Feedback buffers](#feedback-buffers)) */
  feedback?: FeedbackOptions;
}
```

### `update(time, mouse?)`

Called every frame, for dynamic uniform updates. Time and mouse position are already reflected in
`uTime` / `uMouse`, so update other state here (ping-pong of your own RTs, values changed from the GUI, and so on).

```ts
update() {
  this.setUniform('uStrength', this.strength);
}
```

### `resize?(width, height)`

Called whenever the canvas size (or the plane size, when added to a `DomPlane`) changes. Effects with
their own RTs resize them here. The same values are available from `this.width` / `this.height`, so you
can also reference them from other methods without overriding `resize()`.

### `setupGUI?(gui)`

A hook called when a lil-gui instance is passed with `new DomSyncGL(..., { gui })`, for adding a folder
to the panel. It is not called if `gui` is not passed.

```ts
setupGUI(gui) {
  const f = gui.addFolder('Tint');
  f.add(this, 'enabled');
  f.addColor(this.getUniform('uColor')!.value, 'r');
}
```

### `dispose?()`

Called when the effect is removed from `addEffect` or on `app.destroy()`. Override it if you hold RTs or similar resources.

## Helpers

| Method                    | Description                                                        |
| ------------------------- | ------------------------------------------------------------------ |
| `setUniform(key, value)`  | Updates the `.value` of a uniform (warns in DEV for undefined keys) |
| `getUniform(key)`         | Gets a `UniformNode` (read and write it through `.value`)          |
| `getPass()`               | Gets the internal `EffectPass`                                     |
| `enabled` (getter/setter) | `false` makes it a pass-through                                    |

## EffectComposer / EffectPass

Low-level APIs. Refer to them when implementing your own `EffectLike`.

```ts
import { EffectComposer, EffectPass, type EffectLike } from "dom-sync-gl";
```

Pass an `EffectLike` to `DomSyncGL.setPostEffect(effectLike)` to plug in your own post effect pipeline
entirely (it cannot be combined with `addEffect()`).
