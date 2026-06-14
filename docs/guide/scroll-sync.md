# Scroll Sync

ネイティブの `window.scrollY` と canvas の描画位置がズレないようにするレイヤ。

## 有効化

```ts
const app = new DomSyncGL('#canvas', {
  scrollSync: true,
});
```

`scrollSync: true` を渡すと container を `position: absolute` で document に貼り、毎 rAF
で実効 scrollY を transform に流して viewport に追従させる。

## 実効 scrollY と iOS Safari の rubber-band

実効 scrollY は `-document.documentElement.getBoundingClientRect().top` から取る。
普段は `window.scrollY` と同じ値になるが、iOS Safari の上端 rubber-band /
pull-to-refresh 中は visual viewport の offset が乗って負に振れる。この同じ値を
container の transform と plane の位置計算の両方に流しているので、rubber-band 中も
canvas と DOM が同じ分だけズレて見た目が揃う。pull-to-refresh も殺さずに済む。

## オプション

```ts
new DomSyncGL('#canvas', {
  scrollSync: { trackStrength: true },
});
```

| option | type | default | 説明 |
|---|---|---|---|
| `trackStrength` | `boolean` | `false` | スクロール速度の getter を有効化 |
| `strengthDecay` | `number` | `10` | strength の指数減衰係数 |

## RafScroll（rAF 同期 virtual scroll）

`RafScroll` を併用すると wheel / touch の入力を rAF tick にまとめて発火させるので、
JS が読む scrollY と paint された位置がフレーム内で揃う。

**推奨は `rafScroll` オプション**。Core が RafScroll を管理下に置き、自身の単一 rAF ループ内で
`scrollTo` → `scroll 読み取り` の順に駆動するため、背景・plane が 1 フレームずれない。

```ts
const app = new DomSyncGL('#canvas', {
  scrollSync: true,
  rafScroll: {
    touchFriction: 0.95, // タッチリリース後の慣性（0 で慣性なし）
  },
});
```

| option | type | default | 説明 |
|---|---|---|---|
| `lineHeight` | `number` | `16` | `WheelEvent.deltaMode=LINE` 時の 1 行 px |
| `touchFriction` | `number` | `0.95` | タッチリリース後の慣性減衰率。`0` で慣性無効 |
| `autoStart` | `boolean` | `true` | 自前 rAF ループを起動するか。`rafScroll` オプション経由なら自動で `false`（管理モード） |

::: warning 自前生成するなら順序に注意
`new RafScroll()` を別途生成して併用する場合、RafScroll と Core は**別々の rAF ループ**を持つ。
ブラウザは rAF を登録順に実行するため、`DomSyncGL` より**後に**生成すると Core が 1 フレーム古い
scrollY を読み、背景 canvas がスクロール中だけズレる。自前生成するなら必ず `DomSyncGL` より
**先に**生成すること。順序を気にしたくなければ上記の `rafScroll` オプションを使う。
:::

### pull-to-refresh は壊さない

RafScroll はモバイル上端の下方向 swipe を検出したら `preventDefault` せず native に
任せる。`overscroll-behavior` を `none/contain` にしていなければ pull-to-refresh は
そのまま動く。

## Demo

→ [Demos / Scroll Sync](/demos/scroll-sync) に動くサンプルとコードを置いている。
