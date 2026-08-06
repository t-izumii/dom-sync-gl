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
2. 非表示のミラー要素にテキストを流し込み、**改行位置をブラウザ自身に決めさせる**
3. その値で `element.textContent` を canvas 2D に描画する
4. canvas を `CanvasTexture` として plane に貼る
5. 元の DOM テキストを `color: transparent` にして視覚的にだけ隠す

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
`letterSpacing` / `textAlign` / `padding` / `paddingTop` / `paddingRight` /
`paddingBottom` / `paddingLeft` / `verticalAlign` を個別に上書きできる。
指定しなかったものは CSS 由来のまま。

```ts
app.createTextPlane('.headline', {
  style: { color: '#ff0000', letterSpacing: 2 },
});
```

## 余白（padding）

要素の `padding` は `getComputedStyle` から読み取られ、そのままテキストの余白として
引き継がれる。板そのものは `getBoundingClientRect()` 由来なので padding を含んだ
border-box 全体を覆い、その内側にコンテンツ領域が確保される形になる。

| padding | 効き方 |
|---|---|
| `padding-left` / `padding-right` | 折り返し幅（コンテンツ幅）と、`text-align` に応じた描画開始 x に反映される |
| `padding-top` | テキストブロックの上端の基準になる |
| `padding-bottom` | コンテンツ領域の下端を決める。`verticalAlign` が `top` 以外のときに効く |

JS 側から上書きしたい場合は `style` を使う。`padding` は 4 辺一括で、
個別指定と併用した場合は CSS と同じく個別指定が勝つ。

```ts
// CSS の padding を無視して板の全面に描く
app.createTextPlane('.headline', { style: { padding: 0 } });

// 左だけ広げる（上下右は CSS 由来のまま）
app.createTextPlane('.headline', { style: { paddingLeft: 80 } });
```

### `verticalAlign`

コンテンツ領域（要素高さから `padding-top` / `padding-bottom` を引いた範囲）に対する
テキストブロックの縦揃え。CSS 側の対応物は `align-content` で、`center` なら
`center`、`end` / `flex-end` なら `bottom`、それ以外（`normal` や未対応環境）は
`top` に解決される。`style.verticalAlign` で明示的に上書きできる。

```ts
app.createTextPlane('.button-label', { style: { verticalAlign: 'center' } });
```

::: warning 溢れてもクリップしない
テキストがコンテンツ領域に収まらない場合でも位置はクランプされず、そのまま描画される
（CSS の `overflow: visible` 相当）。`padding-bottom` を大きく取ったうえで行数が増えると
余白を突き抜けるので、収めたい場合は要素側の高さか `line-height` で調整する。
:::

::: tip なぜ vertical-align ではなく align-content なのか
`vertical-align` はインラインボックス内の揃えを決めるプロパティで、ブロックの
縦方向の配置には効かない。ブロックコンテナに対して縦揃えを指定できる現行の CSS は
`align-content` なので、そちらを参照している。
:::

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
- 各段落は要素の幅（padding を除いた領域）で折り返される。**改行位置はブラウザが決める**（下記）
- canvas の辺長は 4096px でクランプされる（巨大要素 × 高 DPR で VRAM が溢れないように）

### 改行位置は DOM と一致する

canvas 2D には行分割の API が無い。自前で「空白で区切って幅で折る」実装をすると、
日本語のように空白の無い言語では文字単位の均等分割になり、禁則処理（`。` や `、` が
行頭に来ない、など）も効かないため、DOM の見た目とずれる。

そこで、画面外に置いた非表示のミラー要素へ同じ字送りでテキストを流し込み、
`Range.getClientRects()` で**ブラウザが実際に決めた行ボックス**を読み取って、
その通りに描画している。UAX #14 の分割規則も禁則処理も英単語の非分割も、
すべてブラウザの実装がそのまま反映される。

要素の `word-break` / `overflow-wrap` / `line-break` も computed style から
ミラーへ写すので、CSS で折り返し方を制御すれば板側も同じように追従する。

::: tip レイアウトが無い環境
SSR や jsdom のように行ボックスを持たない環境では矩形が取れないので、
空白区切り + 文字単位フォールバックの自前実装（`layoutLines()`）に自動で切り替わる。
ブラウザでの表示には影響しない。
:::

::: warning 行の縦位置はわずかにずれる
改行位置は一致するが、行の縦位置は canvas の `textBaseline: middle` 基準で決めているため、
DOM の half-leading（行ボックス内での文字の配置）とは厳密には一致しない。
DOM テキストと GL テキストを重ねて表示する場合はこの差が見える。
:::

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
