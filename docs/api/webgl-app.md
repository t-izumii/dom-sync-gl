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
| `rafScroll` | `boolean \| RafScrollOptions` | `false` | RafScroll を Core 管理下で有効化（単一 rAF に統合し生成順依存を排除）。詳細は [Scroll](/api/scroll) |
| `enableMouseTracking` | `boolean` | `true` | マウス座標と hover 判定を更新 |
| `maxPixelRatio` | `number` | `2` | `renderer.setPixelRatio` の上限（モバイルは `1.5` 推奨） |
| `outputColorSpace` | `THREE.ColorSpace` | `SRGBColorSpace` | renderer の出力色空間 |
| `showStats` | `boolean` | `false` | stats.js の FPS パネルを表示 |
| `statsParent` | `HTMLElement` | `document.body` | パネルの append 先 |
| `showGUI` | `boolean` | `true` | `setupGUI()` を実装したエフェクトに lil-gui を渡す |
| `guiTitle` | `string` | `'Effects'` | lil-gui ルートタイトル |

## Methods

### `createPlane(selector, options?)` / `removePlane(plane)`

DOM 要素にロックした plane を生成 / 削除する。`selector` に `null` を渡すと全画面背景になる。
返り値は [`DomPlane`](/api/dom-plane)。

```ts
const plane = app.createPlane('.card', {
  fragmentShader,
  updateRectEveryFrame: true,
  onInView: (p) => (p.material.uniforms.uIntensity.value = 1),
});
app.removePlane(plane); // 1 つだけ取り外して destroy
```

### `create3DObject(selector, options)` / `remove3DObject(obj)`

GLTF モデルを DOM 要素の bbox にフィットさせる。返り値は `Dom3DObject`（`getModel()` / `resize()` / `destroy()` を持つ）。

```ts
const obj = app.create3DObject('.product', {
  modelPath: '/models/shoe.gltf',
  fitMode: 'maxSide',
});
app.remove3DObject(obj);
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

### `setPostEffect(effectLike)`

`EffectLike` (= `render` / `resize` / `dispose` を実装) を渡して、ポストエフェクト
パイプライン全体を独自実装に差し替える低レベル API。通常は `addEffect()` を使う。

::: warning addEffect と併用しない
`addEffect()` で追加済みのエフェクトがある状態で呼ぶと内部 EffectComposer を破棄して
差し替える。事前に `clearEffects()` を呼ぶこと（DEV では throw する）。
:::

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

### Getters

| getter | 返り値 | 用途 |
|---|---|---|
| `getScene()` | `THREE.Scene` | Three.js の生 scene |
| `getCamera()` | `Camera` | カメララッパー（`.instance` で `THREE.PerspectiveCamera`） |
| `getRenderer()` | `THREE.WebGLRenderer` | renderer |
| `getLight()` | `Light` | ambient + directional のラッパー |
| `getViewPort()` | `DOMRect` | canvas の logical rect（ScrollSync 有効時は viewport ぴったり） |
| `getMouse()` | `THREE.Vector2` | 現フレの canvas UV (0..1, Y-up) |
| `getScroll()` | `Readonly<{ x: number; y: number }>` | Core が rAF tick で確定した現フレのスクロール値キャッシュ（live 参照。保持時は clone） |
| `getPrevMouse()` | `THREE.Vector2` | 前フレの UV |
| `getMouseDelta()` | `THREE.Vector2` | `current - prev`（毎フレ scratch なので保持したいときは clone） |
| `getControls()` | `OrbitControls \| null` | `enableOrbitControls()` 後のインスタンス |
| `getScrollSync()` | `ScrollSync \| null` | `scrollSync: true` で構築した場合の内部インスタンス |
| `getRafScroll()` | `RafScroll \| null` | `rafScroll` オプションで構築した管理下インスタンス |
| `getGUI()` | `GUI \| null` | lil-gui のルート（load 完了前は null） |
| `getGUIAsync()` | `Promise<GUI \| null>` | lil-gui を必要に応じて load してから返す |

### `enableOrbitControls()`

three の `OrbitControls` を canvas に紐付けて返す。`scrollSync: true` のとき、
container に当てている `pointer-events: none` を canvas だけ復活させて入力を通す。

### `destroy()`

リスナー・テクスチャ・RT をすべて解放する。SPA で plane / app をマウント解除するときは必ず呼ぶ。
