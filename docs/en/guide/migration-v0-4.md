# Migrating from v0.3 (GLSL)

v0.4 moves the renderer to `WebGPURenderer` from `three/webgpu` and replaces the shader contract,
changing it from GLSL strings to **TSL (Three.js Shading Language) node factories**.
The old GLSL API (`fragmentShader` / `vertexShader` / `uniforms` in `IUniform` form) no longer exists.

three compiles TSL shaders to WGSL (WebGPU) or GLSL (WebGL 2), so **one implementation supports both
backends**. Where WebGPU is unavailable it falls back to WebGL 2 automatically, so you do not need to
think about the backend.

## Breaking changes

| Change | v0.3 | v0.4 |
|---|---|---|
| Plane shaders | `fragmentShader` / `vertexShader` (GLSL strings) | `colorNode` / `positionNode` (TSL node factories) |
| Effect shaders | `BaseEffectConfig.fragmentShader` | `BaseEffectConfig.outputNode` |
| Feedback shaders | `FeedbackBufferOptions.fragmentShader` | `FeedbackBufferOptions.outputNode` |
| Uniform format | `{ uX: { value: 0 } }` (`IUniform`) | `{ uX: uniform(0) }` (TSL `UniformNode`) |
| Reading the previous pass | Declare `uniform sampler2D tDiffuse` | Use `ctx.inputTexture` |
| `addFeedback()` | A uniform named `outputUniform` is added automatically | **Declare in advance** a `texture()` node with the same name as `outputUniform` in `options.uniforms` |
| `uIsHovered` | `bool` | `float` (0 / 1) |
| Initialization | Synchronous | Asynchronous (`await app.ready`; safe to skip) |
| `textureColorSpace` default | `NoColorSpace` | `SRGBColorSpace` |
| renderer | `THREE.WebGLRenderer` | `THREE.WebGPURenderer` (`three/webgpu`) |
| three peer dependency | `>=0.150.0` | `>=0.181.0 <0.183.0` |

## GLSL → TSL mapping

| GLSL (v0.3) | TSL (v0.4) |
|---|---|
| `varying vec2 vUv` | `ctx.uv` (received from ctx without declaring it) |
| `uniform float uTime;` + `uniforms: { uTime: { value: 0 } }` | Create `const uTime = uniform(0)` and pass `uniforms: { uTime }` |
| `texture2D(uTexture, vUv)` | `ctx.uTexture` (sampled with `uv()` as-is). To read it with a different UV, use `ctx.uTexture.sample(customUv)` |
| `texture2D(tDiffuse, vUv)` | `ctx.inputTexture` |
| `gl_FragColor = vec4(...);` | `return vec4(...)` |
| `a * b + c` | `a.mul(b).add(c)` |
| `sin` / `mix` / `smoothstep` / `fract` / `dot` / `distance` … | Import the functions of the same name from `three/tsl` (or the re-exported `TSL`) |
| `cond ? a : b` | `select(cond, a, b)` |
| `material.uniforms.uX.value = v` | `.value = v` on the `UniformNode` you keep (effects still use `setUniform()`) |

You can import the TSL node builders from `three/tsl` directly or use the `TSL` namespace re-exported
by this library.

```ts
import { TSL } from 'dom-sync-gl';
const { uniform, texture, uv, vec2, vec3, vec4, sin, mix } = TSL;
```

## Example 1: createPlane shaders

::: code-group

```ts [v0.3 (GLSL)]
app.createPlane('.hero-card', {
  fragmentShader: `
    precision highp float;
    varying vec2 vUv;
    uniform float uTime;
    void main() {
      gl_FragColor = vec4(vUv, 0.5 + 0.5 * sin(uTime), 1.0);
    }
  `,
});
```

```ts [v0.4 (TSL)]
import { TSL } from 'dom-sync-gl';
const { vec4, sin } = TSL;

app.createPlane('.hero-card', {
  colorNode: ({ uv, uTime }) =>
    vec4(uv, sin(uTime).mul(0.5).add(0.5), 1),
});
```

:::

`colorNode` is **called only once, when the plane is created**, and returns a TSL node graph. From then
on, per-frame updates happen when the library replaces the `.value` of the nodes passed in `ctx`
(such as `uTime`). Note that the factory is not the place for per-frame JS logic (once built, the graph is fixed).

## Example 2: BaseEffect

::: code-group

```ts [v0.3 (GLSL)]
class GrainEffect extends BaseEffect {
  protected getConfig(): BaseEffectConfig {
    return {
      fragmentShader: `
        precision highp float;
        uniform sampler2D tDiffuse;
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          vec4 src = texture2D(tDiffuse, vUv);
          float g = fract(sin(dot(vUv + uTime,
            vec2(12.9898, 78.233))) * 43758.5453);
          gl_FragColor = vec4(src.rgb + (g - 0.5) * 0.06, src.a);
        }
      `,
      uniforms: { uTime: { value: 0 } },
    };
  }
  update(time: number) {
    this.setUniform('uTime', time);
  }
}
```

```ts [v0.4 (TSL)]
import { TSL } from 'dom-sync-gl';
const { uniform, vec2, vec4, fract, sin, dot } = TSL;

class GrainEffect extends BaseEffect {
  private uTime = uniform(0);

  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: ({ inputTexture, uv }) => {
        const g = fract(
          sin(dot(uv.add(this.uTime), vec2(12.9898, 78.233)))
            .mul(43758.5453),
        );
        return vec4(
          inputTexture.rgb.add(g.sub(0.5).mul(0.06)),
          inputTexture.a,
        );
      },
      uniforms: { uTime: this.uTime },
    };
  }
  update(time: number) {
    this.setUniform('uTime', time);
  }
}
```

:::

The automatic `tDiffuse` wiring is gone; the result of the previous pass arrives as `ctx.inputTexture`
(a `TextureNode`). `setUniform()` / `getUniform()` work the same way (`getUniform()` now returns a
`UniformNode` instead of an `IUniform`, but both have `.value`).

## Example 3: addFeedback

In v0.4 the colorNode graph is **fixed at construction time**, so `addFeedback()` cannot add a uniform
later. **Declare the output `texture()` node in advance with the same name** in the `options.uniforms`
of `createPlane`.

::: code-group

```ts [v0.3 (GLSL)]
const plane = app.createPlane('.card', {
  fragmentShader: `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTrailTex; // added automatically by addFeedback
    void main() {
      gl_FragColor = vec4(vec3(texture2D(uTrailTex, vUv).r), 1.0);
    }
  `,
});

const trail = plane.addFeedback({
  fragmentShader: trailFragment,
  size: 256,
  outputUniform: 'uTrailTex',
  uniforms: { uDecay: { value: 0.94 } },
});
```

```ts [v0.4 (TSL)]
import { TSL } from 'dom-sync-gl';
const { texture, uniform, vec2, vec3, vec4, smoothstep, length } = TSL;

// Create the output node in advance (addFeedback replaces its .value every frame)
const uTrailTex = texture();

const plane = app.createPlane('.card', {
  uniforms: { uTrailTex }, // pass it with the same name as outputUniform
  colorNode: () => vec4(vec3(uTrailTex.r), 1),
});

const uDecay = uniform(0.94);
const trail = plane.addFeedback({
  size: 256,
  outputUniform: 'uTrailTex',
  uniforms: { uDecay },
  outputNode: ({ uPrev, uMouse, uHover, uAspect, uv }) => {
    const prev = uPrev.rgb.mul(uDecay);
    const d = uv.sub(uMouse).mul(vec2(uAspect, 1));
    const splat = smoothstep(0.2, 0.0, length(d)).mul(uHover);
    return vec4(prev.add(splat), 1);
  },
});
```

:::

## Behavior changes

### Initialization is now asynchronous (`ready`)

Acquiring a WebGPU device is async, so there is now `ready: Promise<void>`, which resolves when the
renderer finishes initializing. **It is safe not to await it** (`render()` is a no-op until
initialization completes), but await it when you need to act after the backend is decided.

```ts
const app = new DomSyncGL('#canvas');
await app.ready;
console.log(app.isWebGPUBackend()); // false on the WebGL 2 fallback
```

A `forceWebGL: true` option was also added to force the WebGL 2 backend for debugging.

### `textureColorSpace` now defaults to `SRGBColorSpace`

The v0.3 default was `NoColorSpace` (raw values passed through), but the v0.4 `NodeMaterial` converts
linear to sRGB automatically on output. Using `SRGBColorSpace` for the input (decoded to linear when
sampled) makes decode and encode cancel out, so the result matches the image in the DOM. **Only when
you want raw values, such as for data textures,** specify `textureColorSpace: THREE.NoColorSpace`.

```ts
app.createPlane('.card', {
  textureColorSpace: THREE.NoColorSpace, // if you need the old behavior
});
```

### The three peer dependency is now `>=0.181.0 <0.183.0`

The library relies on the `three/webgpu` / `three/tsl` entry points and APIs used internally such as
`QuadMesh` / `RenderTarget`. Signed feedback values are not preserved correctly in 0.180 and earlier,
and the TSL type definitions change significantly in 0.183 and later, so the range is limited to
0.181.x / 0.182.x, which are verified in CI down to actual rendering.
The types have also changed from `THREE.WebGLRenderer` → `THREE.WebGPURenderer` and
`WebGLRenderTarget` → `RenderTarget` (including the type passed to `render({ outputTarget })`).
