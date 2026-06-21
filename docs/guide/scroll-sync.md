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

スムーズスクロールの実体は [Lenis](https://github.com/darkroomengineering/lenis) に委譲している。
`rafScroll` には Lenis のオプションをそのまま渡せる。

```ts
const app = new DomSyncGL('#canvas', {
  scrollSync: true,
  rafScroll: {
    lerp: 0.1,        // 補間強度（小さいほど滑らか・遅延大）
    wheelMultiplier: 1,
    // syncTouch: true, // タッチ操作もスムージングしたい場合（既定はネイティブタッチ）
  },
});
```

| option | type | default | 説明 |
|---|---|---|---|
| `lerp` | `number` | **`1`** | 線形補間の強度（0〜1）。小さいほど滑らかで追従が遅い。既定は補間なし（後述） |
| `syncTouch` | `boolean` | **`true`** | タッチ操作も rAF 経由にするか。既定 true（後述） |
| `duration` | `number` | — | スクロールアニメーションの時間（秒）。`lerp` の代替指定 |
| `easing` | `(t:number)=>number` | Lenis 既定 | イージング関数 |
| `smoothWheel` | `boolean` | `true` | ホイール入力をスムージングするか |
| `wheelMultiplier` | `number` | `1` | ホイール入力の倍率 |
| `touchMultiplier` | `number` | `1` | タッチ入力の倍率 |
| `autoStart` | `boolean` | `true` | 内部 rAF ループを自走させるか。`rafScroll` オプション経由なら自動で `false`（管理モード） |

::: tip 既定値は Lenis と異なる
`scrollSync` はキャンバスを「全スクロールを単一 rAF に取り込む」前提で補正するため、`RafScroll` は
Lenis 既定を上書きして **`lerp: 1`** / **`syncTouch: true`** を初期値にしている。
これにより実スクロールと rAF 読み取りが毎フレーム一致し、`position: fixed` の plane が
スクロール中にガタつかない。スムージングを効かせたい場合は `rafScroll: { lerp: 0.1 }` のように
明示指定すれば上書きできる。
:::

その他のオプションは [Lenis のドキュメント](https://github.com/darkroomengineering/lenis#instance-settings) を参照。

::: warning 自前生成するなら順序に注意
`new RafScroll()` を別途生成して併用する場合、RafScroll と Core は**別々の rAF ループ**を持つ。
ブラウザは rAF を登録順に実行するため、`DomSyncGL` より**後に**生成すると Core が 1 フレーム古い
scrollY を読み、背景 canvas がスクロール中だけズレる。自前生成するなら必ず `DomSyncGL` より
**先に**生成すること。順序を気にしたくなければ上記の `rafScroll` オプションを使う。
:::

### pull-to-refresh は壊さない

既定ではタッチ操作はネイティブのまま（`syncTouch: false`）なので、モバイルの
pull-to-refresh や端のバウンスはそのまま動く。タッチもスムージングしたい場合は
`syncTouch: true` を指定する。

## Demo

→ [Demos / Scroll Sync](/demos/scroll-sync) に動くサンプルとコードを置いている。
