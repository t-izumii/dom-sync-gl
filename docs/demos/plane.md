# DOM-locked Plane

DOM 要素の bbox に追従する Three.js plane に、自前の TSL シェーダーを流し込む例。
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
import { DomSyncGL, TSL } from 'dom-sync-gl';
const { vec2, vec3, vec4, sin, mix, distance, select } = TSL;

const app = new DomSyncGL('#stage');

app.createPlane('#card', {
  colorNode: ({ uv, uTime, uMouseUV, uIsHovered }) => {
    const hovered = uIsHovered.greaterThan(0.5);
    const dist = distance(uv, select(hovered, uMouseUV, vec2(0.5)));
    const ring = sin(dist.mul(12).sub(uTime.mul(1.5))).mul(0.5).add(0.5);
    const col = mix(vec3(0.34, 0.43, 0.99), vec3(0.96, 0.34, 0.62), uv.y)
      .add(ring.mul(0.18));
    return vec4(mix(col, vec3(1), uIsHovered.mul(0.15)), 1);
  },
});
```

## ポイント

### 1. 宣言不要で使えるビルトインノード

`uTime` `uMouseUV` `uIsHovered` `uResolution` `uTexture` `uAlpha` `uv` は
`colorNode` の引数（ctx）から受け取るだけで使える。値の更新は DomSyncGL 側でやる。
詳細は [API: DomPlane](/api/dom-plane#planenodecontext-ビルトインノード)。

### 2. `uIsHovered` は float（0 / 1）

TSL では条件分岐に `select(cond, a, b)` を使う。`uIsHovered` は float なので、
真偽判定には `uIsHovered.greaterThan(0.5)`、強度としてはそのまま `uIsHovered.mul(x)` が使える。

### 3. hover 判定は raycast 駆動

`uIsHovered` は DomSyncGL 内部の raycaster が canvas 上のマウス位置から判定して
更新する。要素の DOM 上の `pointer-events` には依存しない（plane は 3D scene 側)。

### 4. plane を破棄するとき

SPA で plane を unmount するときは `app.destroy()` を必ず呼ぶ。
geometry / material / observer がすべて解放される。

```ts
onBeforeUnmount(() => app.destroy());
```
