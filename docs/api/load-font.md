# loadFont

任意の Web フォントを FontFace API で読み込んで `document.fonts` に登録する独立ユーティリティ。

```ts
import { loadFont } from 'dom-sync-gl';

await loadFont({
  family: 'SpaceMono',
  url: '/fonts/space-mono-400.woff2',
  weight: '400',
  style: 'normal',
});
```

## `DomTextPlane` とは分離されている

フォントの取得・登録は `DomTextPlane` の責務ではない。`loadFont()` は単に
`document.fonts` にフォントを足すだけで、`createTextPlane()` は今まで通り
`getComputedStyle` 由来のスタイルを読むだけ。

この分離のおかげで、font-size / font-weight は常に CSS 側（`clamp()` の fluid 値も含む）が
決められる。

```css
.headline {
  font-family: "SpaceMono", ui-monospace, monospace;
  font-size: clamp(1.2rem, 3vw, 2.2rem);
}
```

```ts
// 1. 取得（Promise を変数にキャッシュしておく）
const spaceMonoReady = loadFont({
  family: 'SpaceMono',
  url: '/fonts/space-mono-400.woff2',
});

// 2. 利用（待ってから板を作る）
spaceMonoReady.then(() => {
  app.createTextPlane('.headline');
});
```

::: tip Promise を変数に持つ
`loadFont()` 自身も同一フォントの重複フェッチを防ぐ内部キャッシュを持つが、キャッシュキーは
呼び出し引数の一致に依存する。同じフォントを複数箇所で使うなら、上のように一度だけ呼んで
Promise を変数に持ち、各利用箇所でそれを await するのが確実。
:::

## Signature

```ts
function loadFont(source: FontFaceSource | FontFaceSource[]): Promise<void>
```

単体でも配列でも渡せる。配列の場合はすべて並列にロードして、全部終わったら解決する。

### `FontFaceSource`

| field | type | 説明 |
|---|---|---|
| `family` | `string` | CSS の `font-family` に指定する名前 |
| `url` | `string` | フォントファイルの URL。単一 URL でも CSS の `url()` / `local()` 構文でもよい |
| `weight` | `string` | `font-weight`（例: `'400'`, `'700'`, `'400 700'`） |
| `style` | `string` | `font-style`（例: `'normal'`, `'italic'`） |
| `descriptors` | `FontFaceDescriptors` | その他の記述子（`unicode-range` 等） |

`weight` / `style` は `descriptors` にマージされる（`descriptors` 側が優先）。

## エラーの扱い

**失敗しても reject しない。** `console.warn` を出して解決する。呼び出し側が毎回 `catch` を
書かなくて済むようにするため。

```ts
// フォントが落ちてもここは必ず通る。CSS の fallback で描画される。
await loadFont({ family: 'SpaceMono', url: 'https://example.com/dead.woff2' });
app.createTextPlane('.headline');
```

- `FontFace` / `document.fonts` が無い環境では何もせず即 resolve する
- 成功したフォントはキャッシュに残り、二度とフェッチされない
- 失敗したフォントはキャッシュから削除され、次回呼び出しで再試行できる（一時的な
  ネットワークエラーから回復するため）

## 低レベル API

テキストのラスタライズそのものを自前でやりたい場合、内部で使っている関数も export している。

```ts
import { resolveTextStyle, layoutLines, rasterizeText } from 'dom-sync-gl';
import type { ResolvedTextStyle } from 'dom-sync-gl';

// getComputedStyle から font/color/padding 等を解決する
resolveTextStyle(el: HTMLElement, overrides?: TextStyleOverrides): ResolvedTextStyle

// テキストを maxWidth で折り返して行の配列にする。measure は文字列幅を返す関数
layoutLines(text: string, maxWidth: number, measure: (s: string) => number): string[]

// canvas にテキストを描画する。描けたら true
rasterizeText(
  canvas: HTMLCanvasElement,
  text: string,
  style: ResolvedTextStyle,
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
): boolean
```

`rasterizeText()` は辺長が 4096px を超える場合、`pixelRatio` を自動で下げてクランプする。
