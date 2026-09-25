# Post Effect

An example that applies a Grain post effect to a fullscreen background plane and lets you toggle it.

## Demo

<DemoEffect />

## HTML

For post effects alone, you do not need a DOM element for a plane to stick to.
One container for WebGL is enough.

```html
<div id="stage" style="position: relative; height: 280px; overflow: hidden;"></div>
```

## TypeScript

```ts
import { DomSyncGL, BaseEffect, type BaseEffectConfig, TSL } from 'dom-sync-gl';
const { uniform, vec2, vec3, vec4, sin, mix, fract, dot } = TSL;

const app = new DomSyncGL('#stage');

// 1. A fullscreen background plane (pass null as the selector)
app.createPlane(null, {
  colorNode: ({ uv, uTime }) => {
    const wave = sin(uv.x.mul(8).add(uTime.mul(0.8))).mul(0.5).add(0.5);
    const col = mix(
      vec3(0.13, 0.18, 0.36),
      vec3(0.43, 0.95, 0.96),
      uv.y.mul(wave),
    );
    return vec4(col, 1);
  },
});

// 2. Write a post effect
class GrainEffect extends BaseEffect {
  private uTime = uniform(0);
  private uAmount = uniform(0.18);

  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: ({ inputTexture, uv }) => {
        const g = fract(
          sin(dot(uv.add(this.uTime), vec2(12.9898, 78.233))).mul(43758.5453),
        );
        return vec4(
          inputTexture.rgb.add(g.sub(0.5).mul(this.uAmount)),
          inputTexture.a,
        );
      },
      uniforms: { uTime: this.uTime, uAmount: this.uAmount },
    };
  }
  update(time: number) {
    this.setUniform('uTime', time);
  }
}

// 3. Add it to the chain
const grain = app.addEffect(new GrainEffect());

// 4. Toggle it
button.addEventListener('click', () => {
  grain.enabled = !grain.enabled;
});
```

## Notes

### 1. Read the previous pass from `ctx.inputTexture`

A post effect's `outputNode` reads the previous result from the `inputTexture` (`TextureNode`) passed in
ctx. The EffectComposer wires it automatically (the v0.3 `tDiffuse` declaration is no longer needed).
Used as-is, it is sampled with `uv()`; to distort it, read it from a different UV with
`inputTexture.sample(customUv)`.

### 2. Chain order = the order of `addEffect` calls

```ts
app.addEffect(new BlurEffect());
app.addEffect(new GrainEffect()); // Grain is applied after Blur
```

They are applied in order with ping-pong RTs. However many effects you add, only two RTs are used.

### 3. `enabled = false` is a pass-through

With `BaseEffect.enabled = false`, the pass is skipped and its input goes straight to the next one.
Resources are kept, so turning it back on is cheap. To dispose it completely, use `app.removeEffect(grain)`.

### 4. You can also build per-plane chains

`plane.addEffect(effect)` builds a separate chain that applies only to that plane.
It runs independently of the fullscreen effects.

```ts
const card = app.createPlane('#card', { colorNode });
card.addEffect(new GrainEffect());
```

::: warning Do not reuse the same instance
Passing the same `effect` instance to both `app.addEffect()` and `plane.addEffect()` runs `update()`
twice in the same frame and corrupts its internal state. Create a new instance for each target.
:::

### 5. Adjusting it dynamically with lil-gui

```ts
class GrainEffect extends BaseEffect {
  amount = 0.18;
  setupGUI(gui) {
    const f = gui.addFolder('Grain');
    f.add(this, 'amount', 0, 0.5).onChange((v) => this.setUniform('uAmount', v));
    f.add(this, 'enabled');
  }
}
```

When a lil-gui instance is passed, as in `new DomSyncGL(..., { gui: new GUI() })`, `setupGUI()` is
called automatically. `lil-gui` is an optional peer, so `npm install lil-gui` only when you use it.
