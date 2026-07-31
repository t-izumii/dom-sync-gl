# DomPlane

`app.createPlane()` の戻り値。Three.js mesh / material のラッパーで、DOM 要素の位置に追従する。

## CreatePlaneOptions

| option | type | default | 説明 |
|---|---|---|---|
| `colorNode` | `(ctx: PlaneNodeContext) => Node` | テクスチャをそのまま表示 | plane の色を決める vec4 ノードを返す TSL ファクトリ |
| `positionNode` | `(ctx: PlaneNodeContext) => Node` | 既定の頂点処理 | 頂点変位用の position ノードを返すファクトリ |
| `uniforms` | `Record<string, UniformNode>` | `{}` | TSL の `uniform()` / `texture()` で生成した自前のノード。`ctx.uniforms` から参照できる |
| `updateRectEveryFrame` | `boolean` | `false` | 毎フレ bbox を取り直す（CSS animation / GSAP で動く要素用） |
| `segments` | `number` | `1` | PlaneGeometry セグメント数（vertex displacement 用） |
| `onInView` / `onOutView` | `(plane) => void` | — | IntersectionObserver コールバック |
| `inViewRootMargin` | `string` | `'100%'` | IO の rootMargin |
| `inViewRepeat` | `boolean` | `false` | `true` で出入りのたび発火 |
| `crossOrigin` | `string` | `'anonymous'` | `data-texture` 読み込み時の CORS 属性 |
| `textureColorSpace` | `THREE.ColorSpace` | `SRGBColorSpace` | `data-texture` で読むテクスチャの色空間。[後述](#texturecolorspace) |

`colorNode` / `positionNode` は plane 構築時に**一度だけ**呼ばれてノードグラフを返す。
以後の毎フレーム更新は ctx のノードの `.value` 差し替えで行われる（グラフは組み直されない）。

## PlaneNodeContext（ビルトインノード）

`colorNode` / `positionNode` ファクトリの引数。宣言不要で使えるノードが渡ってくる。

| ノード | 型 | 中身 |
|---|---|---|
| `uTime` | `UniformNode<number>` | 経過秒 |
| `uResolution` | `UniformNode<Vector2>` | plane の pixel 寸法 |
| `uTexture` | `TextureNode` | `data-texture` 属性 or `setTexture()` で渡したテクスチャ |
| `uAlpha` | `UniformNode<number>` | 透明度（既定 1.0） |
| `uMouseUV` | `UniformNode<Vector2>` | hover 中の plane-local UV (0..1, 左下原点) |
| `uPrevMouse` | `UniformNode<Vector2>` | 前フレームの `uMouseUV`（同じ左下原点）。初回は `uMouseUV` と同値 |
| `uMove` | `UniformNode<number>` | マウス移動強度 (0..1)。静止すると緩やかに 0 へ落ちる |
| `uIsHovered` | `UniformNode<number>` | raycast hit 中なら 1、そうでなければ 0（float） |
| `uniforms` | `Record<string, UniformNode>` | `options.uniforms` で渡した自前のノード |
| `uv` | `Node` | UV ノード |

これらの名前は**予約 uniform 名**で、`options.uniforms` から同名のノードを渡すと throw する
（内部で毎フレーム更新するため）。

## Methods

### `addEffect(effect)` / `removeEffect(effect)`

plane 単位の **post エフェクト**チェーン（描画パイプラインに書き込む sink）。詳細は [Post Effects](/guide/post-effects)。

### `addFeedback(options)` / `removeFeedback(buffer)`

plane に **feedback バッファ（generator）** を紐づける。RenderTarget 2 枚の ping-pong で状態を
時間蓄積し、その出力テクスチャを毎フレ `options.outputUniform` と同名の `texture()` ノードに
供給する（マウス軌跡・流体・拡散など）。RT 確保 / 毎フレ駆動 / dispose はライブラリが面倒を見る。
返り値は [`FeedbackBuffer`](/guide/post-effects#feedback-バッファ-generator)。

colorNode のノードグラフは構築時に確定するため、**出力先の `texture()` ノードを
`createPlane` の `options.uniforms` に `outputUniform` と同名で事前宣言しておく**必要がある
（無いと throw する）。

```ts
import { TSL } from 'dom-sync-gl';
const { texture, uniform, vec3, vec4 } = TSL;

const uTrailTex = texture(); // 出力先ノードを事前宣言
const plane = app.createPlane('.card', {
  uniforms: { uTrailTex },
  colorNode: () => vec4(vec3(uTrailTex.r), 1),
});

plane.addFeedback({
  outputNode: trailNode, // uPrev/uMouse/uHover を読んで軌跡を蓄積する TSL ファクトリ
  size: 256,
  outputUniform: 'uTrailTex',
  uniforms: { uDecay: uniform(0.94), uRadius: uniform(0.2) },
});
```

`addEffect`（絵を加工する post）と `addFeedback`（素材テクスチャを産む generator）は**出力の向きが逆**。
詳細は [Post Effects / Feedback バッファ](/guide/post-effects#feedback-バッファ-generator)。

### `setTexture(texture, takeOwnership?)`

内部の `uTexture`（`TextureNode`）の `.value` を差し替える。`takeOwnership: true` を渡した
texture は `destroy()` 時に dispose される。

### `reloadTexture()`

`data-texture` 属性を読み直してマテリアルに反映する。SPA で image URL を差し替えたいときに。

### `getMouseUV()` / `isHovered()`

直近の plane ローカル UV と hover 状態。

### `setHoverInfo(isHovered, uv)`

raycast 結果を DomSyncGL 側から流し込む内部 API。通常は触らない。

### `getMesh()`

THREE.Mesh 本体。shadow / layer 等を直接弄りたいときに。

### `resize()`

DOM サイズの再計算 + ノード/scale の更新。DomSyncGL の resize で自動で呼ばれる。

### `destroy()`

geometry / material / observer / planeComposer / 自前 load した texture をすべて解放する。

## Texture via attribute

```html
<div class="card" data-texture="/img/photo.jpg"></div>
```

```ts
// colorNode 未指定ならテクスチャがそのまま表示される
app.createPlane('.card');

// 自前の colorNode から使う場合は ctx.uTexture を参照する
app.createPlane('.card', {
  colorNode: ({ uTexture }) => uTexture, // そのままで uv() サンプルされる
});
```

要素に `data-texture` 属性があると、自動で `THREE.TextureLoader` で読み込んで
`uTexture` ノードに流し込む。別 UV で読みたい場合は `uTexture.sample(customUv)`。

## textureColorSpace

`data-texture` で読み込むテクスチャの色空間。既定は **`SRGBColorSpace`**。

サンプル時に linear へデコードされ、画面出力時に sRGB へ再エンコードされるため、DOM の
`<img>` と表示色が一致する（NodeMaterial は画面出力時の色空間変換を自動で行うため、v0.3 の
「生の値を素通しする」前提の `NoColorSpace` 既定から変更された）。データテクスチャ等で
生の値をそのまま扱いたい場合のみ `NoColorSpace` を指定する。

```ts
app.createPlane('.card', {
  textureColorSpace: THREE.NoColorSpace, // 旧挙動（生の値を素通し）
});
```
