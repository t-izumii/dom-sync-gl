# DomPlane

`app.createPlane()` の戻り値。Three.js mesh / material のラッパーで、DOM 要素の位置に追従する。

## CreatePlaneOptions

| option | type | default | 説明 |
|---|---|---|---|
| `vertexShader` / `fragmentShader` | `string` | デフォルト passthrough | shader ソース |
| `uniforms` | `{ [key]: IUniform }` | `{}` | ユーザー定義 uniform |
| `updateRectEveryFrame` | `boolean` | `false` | 毎フレ bbox を取り直す（CSS animation / GSAP で動く要素用） |
| `segments` | `number` | `1` | PlaneGeometry セグメント数（vertex displacement 用） |
| `onInView` / `onOutView` | `(plane) => void` | — | IntersectionObserver コールバック |
| `inViewRootMargin` | `string` | `'100%'` | IO の rootMargin |
| `inViewRepeat` | `boolean` | `false` | `true` で出入りのたび発火 |
| `crossOrigin` | `string` | `'anonymous'` | `data-texture` 読み込み時の CORS 属性 |

## Built-in uniforms

createPlane で生成される plane には、宣言するだけで使える uniform が組み込まれている。

| uniform | 型 | 中身 |
|---|---|---|
| `uTime` | `float` | 経過秒 |
| `uResolution` | `vec2` | plane の pixel 寸法 |
| `uTexture` | `sampler2D` | `data-texture` 属性 or `setTexture()` で渡したテクスチャ |
| `uAlpha` | `float` | 透明度（デフォルト 1.0） |
| `uMouseUV` | `vec2` | hover 中の plane-local UV (0..1) |
| `uIsHovered` | `bool` | raycast hit 中か |

## Methods

### `addEffect(effect)` / `removeEffect(effect)`

plane 単位のエフェクトチェーン。詳細は [Post Effects](/guide/post-effects)。

### `setTexture(texture, takeOwnership?)`

`material.uniforms.uTexture` を差し替える。`takeOwnership: true` を渡した texture は
`destroy()` 時に dispose される。

### `reloadTexture()`

`data-texture` 属性を読み直してマテリアルに反映する。SPA で image URL を差し替えたいときに。

### `getMouseUV()` / `isHovered()`

直近の plane ローカル UV と hover 状態。

### `setHoverInfo(isHovered, uv)`

raycast 結果を DomSyncGL 側から流し込む内部 API。通常は触らない。

### `getMesh()`

THREE.Mesh 本体。shadow / layer 等を直接弄りたいときに。

### `resize()`

DOM サイズの再計算 + uniform/scale の更新。DomSyncGL の resize で自動で呼ばれる。

### `destroy()`

geometry / material / observer / planeComposer / 自前 load した texture をすべて解放する。

## Texture via attribute

```html
<div class="card" data-texture="/img/photo.jpg"></div>
```

```ts
app.createPlane('.card', {
  fragmentShader: `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    void main() {
      gl_FragColor = texture2D(uTexture, vUv);
    }
  `,
});
```

要素に `data-texture` 属性があると、自動で `THREE.TextureLoader` で読み込んで
`uTexture` に流し込む。
