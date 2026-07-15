# DomSyncGL

domSyncGL のエントリポイント。renderer / scene / camera を内包し、`createPlane()` や
`addEffect()` のハブになる。

```ts
import { DomSyncGL } from 'dom-sync-gl';

const app = new DomSyncGL('#canvas', {
  scrollSync: true,
});
```

## Constructor

```ts
new DomSyncGL(selector: string | HTMLElement, options?: DomSyncGLOptions)
```

`selector` で canvas を載せる container を指定する。文字列 or HTMLElement。

## Options

| option | type | default | 説明 |
|---|---|---|---|
| `scrollSync` | `boolean \| ScrollSyncOptions` | `false` | スクロール同期を有効化。詳細は [Scroll](/api/scroll) |
| `autoRaf` | `boolean` | `true` | 内部 rAF ループを回すか。`false` にすると自前の rAF から [`tick()`](#tick-time) で駆動する |
| `enablePointerTracking` | `boolean` | `true` | ポインタ座標と hover 判定を更新 |
| `maxPixelRatio` | `number` | `2` | `renderer.setPixelRatio` の上限（モバイルは `1.5` 推奨） |
| `outputColorSpace` | `THREE.ColorSpace` | `SRGBColorSpace` | renderer の出力色空間 |
| `stats` | `Stats \| null` | `null` | 呼び出し元が生成した stats.js インスタンス。渡すと毎フレーム `begin()`/`end()` を呼ぶ |
| `gui` | `GUI \| null` | `null` | 呼び出し元が生成した lil-gui インスタンス。渡すと `setupGUI()` 系のフックが有効になる |

::: tip stats.js / lil-gui は「渡す」もの
以前の `showStats` / `showGUI` / `statsParent` / `guiTitle` は廃止された。生成・DOM への挿入・
破棄はすべて呼び出し元の責務で、ライブラリはインスタンスを受け取って使うだけ。本番バンドルに
含めたくない場合は、動的 import で開発時だけ生成すればよい。

```ts
let stats: Stats | undefined;
let gui: GUI | undefined;
if (import.meta.env.DEV) {
  stats = new (await import('stats.js')).default();
  stats.showPanel(0);
  document.body.appendChild(stats.dom);
  gui = new (await import('lil-gui')).default({ title: 'Effects' });
}

const app = new DomSyncGL('#canvas', { stats, gui });
```
:::

`enableMouseTracking` は `enablePointerTracking` の別名として残っているが、新しいコードでは
後者を使う。

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

### `createTextPlane(selector, options?)`

DOM 要素のテキストを canvas にラスタライズして、その要素にロックした plane に貼る。
返り値は [`DomTextPlane`](/api/dom-text-plane)（`DomPlane` のサブクラス）。

```ts
const textPlane = app.createTextPlane('.headline', {
  updateRectEveryFrame: true,
});
```

`createPlane()` と違い `selector` に `null` は渡せない（元になる DOM 要素が必須）。
取り外しは `removePlane()` を使う。

### `tick(time?)`

1 フレーム分の更新・描画を実行する。`autoRaf: false` で初期化したときに、アプリ側の rAF
ループから呼ぶ。Lenis と併用する場合は `lenis.raf(time)` の**後**に呼ぶ。

```ts
const app = new DomSyncGL('#canvas', { autoRaf: false });

const raf = (time: number) => {
  lenis.raf(time);
  app.tick(time);
  requestAnimationFrame(raf);
};
requestAnimationFrame(raf);
```

`time` は Lenis との API 対称性のために受け取るだけで、内部では使っていない（経過時間は
内部の `THREE.Clock` から取る）。省略しても動く。

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
| `fitMode` | `'maxSide' \| 'contain'` | `'maxSide'` | bbox を DOM サイズに合わせる方法 |
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

### `setPointerTrackingEnabled(enabled)`

pointer listener の動的 ON/OFF。重い UI を開いている間など、hover 判定を止めたいときに。
`setMouseTrackingEnabled()` は別名として残っている。

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
| `isPointerActive()` | `boolean` | ポインタが canvas 内にあるか |
| `getPointerType()` | `'mouse' \| 'touch' \| 'pen' \| 'none'` | 現在のポインタ種別 |
| `getControls()` | `OrbitControls \| null` | `enableOrbitControls()` 後のインスタンス |
| `getScrollSync()` | `ScrollSync \| null` | `scrollSync` を有効にした場合の内部インスタンス |
| `getGUI()` | `GUI \| null` | `gui` オプションで渡した lil-gui インスタンス |

### `enableOrbitControls()`

three の `OrbitControls` を canvas に紐付けて返す。`scrollSync: true` のとき、
container に当てている `pointer-events: none` を canvas だけ復活させて入力を通す。

### `destroy()`

リスナー・テクスチャ・RT をすべて解放する。SPA で plane / app をマウント解除するときは必ず呼ぶ。
