# Text Planes

テキストレイヤーも WebGL の管理下に置くためのレイヤ。DOM のテキストを canvas に焼いて、
その要素にロックした plane に貼る。

## 使い方

```html
<p class="headline">Hello, WebGL.</p>
```

```ts
const plane = app.createTextPlane('.headline', {
  updateRectEveryFrame: true,
});
```

これだけで `.headline` のテキストが WebGL で描かれる板になる。位置・サイズは
`createPlane()` と同じく DOM に追従する。

## DOM は消えない

元のテキストは `color: transparent` になるだけで、DOM には残り続ける。

- レイアウトは DOM が決めたまま
- スクリーンリーダーからは通常のテキストとして読める
- テキスト選択・検索・SEO もそのまま

見た目だけを WebGL に差し替える、という発想。`display: none` や `opacity: 0` は使わない。

## スタイルは CSS が決める

font-size / font-family / color / line-height / letter-spacing / text-align / padding は
すべて `getComputedStyle` から読む。つまり **`clamp()` のような fluid な指定もそのまま解決される**。

```css
.headline {
  font-family: "Zen Old Mincho", serif;
  font-size: clamp(1.4rem, 3.4vw, 2.6rem);  /* そのまま板に反映される */
  line-height: 1.6;
}
```

JS 側にブレークポイントを書き写す必要はないし、板の見た目を変えたいときに触るのは CSS。
個別に上書きしたい場合だけ `style` オプションを使う。

```ts
app.createTextPlane('.headline', {
  style: { color: '#ff0000' },
});
```

## Web フォントを動的に読む

フォントの取得・登録は `DomTextPlane` の責務ではなく、独立した [`loadFont()`](/api/load-font)
の責務。**取得と利用を分けて、解決を待ってから板を作る**。

```ts
import { loadFont } from 'dom-sync-gl';

// 1. 取得（Promise を変数にキャッシュ）
const spaceMonoReady = loadFont({
  family: 'SpaceMono',
  url: '/fonts/space-mono-400.woff2',
  weight: '400',
});

// 2. 利用（待ってから作る）
spaceMonoReady.then(() => {
  app.createTextPlane('.headline');
});
```

```css
.headline {
  font-family: "SpaceMono", ui-monospace, monospace;
}
```

`loadFont()` は失敗しても reject せず warn するだけなので、フォントが落ちてもページは壊れず
CSS の fallback で描画される。

::: tip 待たずに作るとどうなるか
`createTextPlane()` は初回のラスタライズを `document.fonts.ready` まで待つので、**ページの CSS で
`@font-face` を宣言している**フォントなら待たなくても正しく焼かれる。`loadFont()` の解決を待つ
必要があるのは、`document.fonts.ready` が既に解決した**後**から動的に足すケース。
:::

## 板単位のエフェクトを掛ける

`DomTextPlane` は `DomPlane` のサブクラスなので、`addEffect()` がそのまま使える。
ホバーは `PointerController` が raycast で判定するため、DOM 側の `pointerenter` は不要。

```ts
const plane = app.createTextPlane('.headline');
const hover = new TextHoverEffect();
plane.addEffect(hover);

let v = 0;
app.addUpdateCallback(() => {
  v += ((plane.isHovered() ? 1 : 0) - v) * 0.15;
  hover.setHover(v);
});
```

## 落とし穴

### HTML の改行が段落になる

`textContent` をそのまま焼くので、インデント由来の改行も段落区切りになる。

```html
<!-- 前後に空段落が入る -->
<p class="headline">
  Hello
</p>

<!-- こう書く -->
<p class="headline">Hello</p>
```

### DOM の opacity は板に効かない

reveal アニメーションなどで DOM 側に `opacity: 0` を当てても、板は WebGL 側で描かれ続ける。
「DOM だけ透明・GL の文字は出たまま」になるので、フェードインさせたい場合は板の uniform を
動かすか、そもそも板にしない。

## 次に

- [API: DomTextPlane](/api/dom-text-plane) — 全オプションとメンバー
- [API: loadFont](/api/load-font) — フォント読み込みと低レベル API
