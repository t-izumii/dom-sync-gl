# DOM-locked Plane

DOM 要素の bbox に追従する Three.js plane に、自前の fragment shader を流し込む例。
hover で色がリアクションする。

## Demo

<DemoPlane />

## HTML

WebGL を載せるコンテナ (`stage`) と、plane が貼り付く要素 (`card`) を 1 つずつ用意する。

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

::: tip stage の position は必須
`createPlane()` の plane は内部で `card.getBoundingClientRect()` を見るので、
card がきちんと stage の中央に配置されている必要がある。stage に
`position: relative` を付け忘れると、absolute な card が祖先まで escape して
plane が変な場所にロックされる。
:::

## TypeScript

```ts
import { WebGLApp } from 'dom-sync-gl';

const app = new WebGLApp('#stage');

app.createPlane('#card', {
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform float uTime;
    uniform vec2 uMouseUV;
    uniform bool uIsHovered;

    void main() {
      vec2 uv = vUv;
      float dist = distance(uv, uIsHovered ? uMouseUV : vec2(0.5));
      float ring = 0.5 + 0.5 * sin(dist * 12.0 - uTime * 1.5);
      vec3 col = mix(
        vec3(0.34, 0.43, 0.99),
        vec3(0.96, 0.34, 0.62),
        uv.y
      );
      col += ring * 0.18;
      col = mix(col, vec3(1.0), uIsHovered ? 0.15 : 0.0);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
```

## ポイント

### 1. 宣言だけで使える uniform

`uTime` `uMouseUV` `uIsHovered` `uResolution` `uTexture` `uAlpha` は declarations
を書くだけで使える。値の更新は WebGLApp 側でやる。詳細は
[API: DomPlane](/api/dom-plane#built-in-uniforms)。

### 2. hover 判定は raycast 駆動

`uIsHovered` は WebGLApp 内部の raycaster が canvas 上のマウス位置から判定して
更新する。要素の DOM 上の `pointer-events` には依存しない（plane は 3D scene 側）。

### 3. plane を破棄するとき

SPA で plane を unmount するときは `app.destroy()` を必ず呼ぶ。
geometry / material / observer がすべて解放される。

```ts
onBeforeUnmount(() => app.destroy());
```
