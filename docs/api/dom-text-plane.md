# DomTextPlane

DOM 要素のテキストを canvas にラスタライズし、その要素にロックした plane に貼るクラス。
`DomPlane` を継承しているので、`addEffect()` / `isHovered()` / `getMesh()` などは
[DomPlane](/api/dom-plane) と同じものが使える。

`app.createTextPlane(selector, options?)` が返す。直接 new することは想定していない。

```ts
const plane = app.createTextPlane('.headline', {
  updateRectEveryFrame: true,
});
```

## 何をするクラスか

1. `getComputedStyle(element)` から font-size / font-family / color / line-height /
   letter-spacing / text-align / padding を読み取る
2. その値で `element.textContent` を canvas 2D に描画する
3. canvas を `CanvasTexture` として plane に貼る
4. 元の DOM テキストを `color: transparent` にして視覚的にだけ隠す

::: tip なぜ display: none にしないのか
`visibility` / `display` / `opacity` は使わず `color: transparent` にしている。レイアウト・
アクセシビリティ・SEO・テキスト選択をすべて DOM 側に残したまま、見た目だけを WebGL に
差し替えるため。スクリーンリーダーからは通常のテキストのまま読める。
:::

::: warning サイズ・色は CSS が決める
スタイルは常に `getComputedStyle` 由来なので、`font-size: clamp(...)` のような fluid な指定も
そのまま解決される。JS 側にブレークポイントを書き写す必要はない。逆に言うと、板の見た目を
変えたいときに触るのは JS ではなく CSS。
:::

## Options

`CreateTextPlaneOptions` は [`CreatePlaneOptions`](/api/dom-plane#createplaneoptions) を
継承していて、以下が追加される。

| option | type | default | 説明 |
|---|---|---|---|
| `text` | `string` | `element.textContent` | 代わりに描画するテキスト |
| `style` | `TextStyleOverrides` | `{}` | `getComputedStyle` の抽出結果を個別に上書き |
| `pixelRatio` | `number` | `min(devicePixelRatio, 2)` | canvas の解像度倍率 |
| `hideElementText` | `boolean` | `true` | 元 DOM テキストを `color: transparent` で隠すか |

`colorNode` を指定しない場合、テキストの canvas がそのまま `uTexture` として描かれる。
自前の `colorNode` からは `ctx.uTexture` でテキストのテクスチャを参照できる。

### `TextStyleOverrides`

`fontSize` / `fontFamily` / `fontWeight` / `fontStyle` / `color` / `lineHeight` /
`letterSpacing` / `textAlign` を個別に上書きできる。指定しなかったものは CSS 由来のまま。

```ts
app.createTextPlane('.headline', {
  style: { color: '#ff0000', letterSpacing: 2 },
});
```

## Instance members

`DomPlane` のメンバーに加えて:

| member | 型 | 説明 |
|---|---|---|
| `rasterize()` | `void` | canvas を描き直してテクスチャを更新する |
| `setText(text)` | `void` | テキストを差し替える（DOM の `textContent` も更新して再描画） |

`resize()` / `destroy()` はオーバーライドされており、要素のサイズが変わったときは
内部の `ResizeObserver` が自動で再ラスタライズする。`destroy()` は隠したテキストの
`color` を元に戻す。

## テキストの扱い

- `\n` は段落区切りとして尊重される
- 各段落の中の連続空白は 1 つのスペースに正規化され、前後は trim される
- 空白で単語に分割して、要素の幅（padding を除いた領域）で折り返す
- canvas の辺長は 4096px でクランプされる（巨大要素 × 高 DPR で VRAM が溢れないように）

::: warning HTML の改行が段落になる
`textContent` をそのまま使うので、HTML のインデント由来の改行も段落区切りとして扱われる。
意図しない空行が入る場合は、要素のテキストを 1 行で書くか `text` オプションで明示する。

```html
<!-- これは前後に空段落が入る -->
<p class="headline">
  Hello
</p>

<!-- こう書く -->
<p class="headline">Hello</p>
```
:::

## フォントの読み込み待ち

初回のラスタライズは `document.fonts.ready` を待ってから行う（Web フォント適用前の
フォントで焼き付けてしまわないため）。ページのフォントが既にロード済みなら待たずに描画する。

任意の Web フォントを動的に読む場合は [`loadFont()`](/api/load-font) を使い、
**解決を待ってから** `createTextPlane()` を呼ぶ。
