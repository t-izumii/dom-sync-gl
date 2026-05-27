# WebGLApp

domSyncGL のエントリポイント。renderer / scene / camera を内包し、`createPlane()` や
`addEffect()` のハブになる。

```ts
import { WebGLApp } from 'dom-sync-gl';

const app = new WebGLApp('#canvas', {
  scrollSync: true,
});
```

## Constructor

```ts
new WebGLApp(selector: string | HTMLElement, options?: WebGLAppOptions)
```

`selector` で canvas を載せる container を指定する。文字列 or HTMLElement。

## Options

| option | type | default | 説明 |
|---|---|---|---|
| `scrollSync` | `boolean \| ScrollSyncOptions` | `false` | スクロール同期を有効化 |
| `enableMouseTracking` | `boolean` | `true` | マウス座標と hover 判定を更新 |
| `maxPixelRatio` | `number` | `2` | `renderer.setPixelRatio` の上限（モバイルは `1.5` 推奨） |
| `outputColorSpace` | `THREE.ColorSpace` | `SRGBColorSpace` | renderer の出力色空間 |
| `showStats` | `boolean` | `false` | stats.js の FPS パネルを表示 |
| `statsParent` | `HTMLElement` | `document.body` | パネルの append 先 |
| `showGUI` | `boolean` | `true` | `setupGUI()` を実装したエフェクトに lil-gui を渡す |
| `guiTitle` | `string` | `'Effects'` | lil-gui ルートタイトル |

## Methods

### `createPlane(selector, options?)`

DOM 要素にロックした plane を生成する。`selector` に `null` を渡すと全画面背景になる。
返り値は [`DomPlane`](/api/dom-plane)。

```ts
const plane = app.createPlane('.card', {
  fragmentShader,
  updateRectEveryFrame: true,
  onInView: (p) => (p.material.uniforms.uIntensity.value = 1),
});
```

### `create3DObject(selector, options)`

GLTF モデルを DOM 要素の bbox にフィットさせる。

```ts
app.create3DObject('.product', {
  modelPath: '/models/shoe.gltf',
  fitMode: 'maxSide',
});
```

| option | type | default | 説明 |
|---|---|---|---|
| `modelPath` | `string` | — | GLTF へのパス |
| `scale` | `number` | `1` | フィット後に掛けるスケール |
| `offset` | `Offset3D` | `{x:0,y:0,z:0}` | フィット後のオフセット |
| `fitMode` | `'maxSide' \| 'contain' \| 'cover'` | `'maxSide'` | bbox を DOM サイズに合わせる方法 |
| `updateRectEveryFrame` | `boolean` | `false` | 毎フレ DOM rect を取り直す |

### `addEffect(effect)` / `removeEffect(effect)` / `clearEffects()`

フルスクリーンチェーンの管理。詳細は [BaseEffect](/api/base-effect)。

### `addObject(obj3d)` / `removeObject(obj3d)`

scene に直接 mesh を出し入れする低レベル API。

### `addUpdateCallback(fn)` / `addResizeCallback(fn)`

```ts
const off = app.addUpdateCallback(() => {
  // 毎フレ呼ばれる
});
off(); // unsubscribe
```

### `setMouseTrackingEnabled(enabled)`

mousemove listener の動的 ON/OFF。重い UI を開いている間など、hover 判定を止めたいときに。

### `getScene()` / `getCamera()` / `getRenderer()` / `getLight()` / `getMouse()` / `getControls()`

内部インスタンスへのアクセス。Three.js の生 API を直接触りたいときに使う。

### `enableOrbitControls()`

three の `OrbitControls` を canvas に紐付けて返す。

### `destroy()`

リスナー・テクスチャ・RT をすべて解放する。SPA で plane / app をマウント解除するときは必ず呼ぶ。
