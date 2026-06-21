# Scroll

スクロール周りの 2 つのクラス: `ScrollSync` と `RafScroll`。
役割は別だが、両方を組み合わせて使うことが多い。

| クラス | 役割 |
|---|---|
| `ScrollSync` | container を `position: absolute` で document に貼り、毎 rAF で viewport に追従させる |
| `RafScroll` | wheel / touch を rAF tick に集約して、`window.scrollY` の更新を 1 frame に 1 回に揃える |

## ScrollSync

通常は `new DomSyncGL(..., { scrollSync: true })` 経由で使う。直接 new することも可能。

### Options

| option | type | default | 説明 |
|---|---|---|---|
| `trackStrength` | `boolean` | `false` | スクロール速度の getter を有効化 |
| `strengthDecay` | `number` | `10` | strength の指数減衰係数 |

### static `ScrollSync.computeEffectiveScrollY()`

`-document.documentElement.getBoundingClientRect().top` を返す。通常は `window.scrollY`
と同値だが、iOS Safari の上端 rubber-band 中は visual viewport offset を取り込んで負に振れる。

### Instance members

| member | 型 | 説明 |
|---|---|---|
| `logicalRect` | `DOMRect` (getter) | viewport ぴったりの `(0, 0, vw, vh)`。canvas drawing buffer サイズに使う |
| `strength` | `number` (getter) | スクロール速度 (0〜1)。`trackStrength: false` の時は常に 0 |
| `enabled` | `boolean` (getter/setter) | `false` にすると `update()` が no-op になり transform 更新が止まる |
| `update(scrollX, scrollY)` | `void` | 毎 rAF で呼ぶ。**plane と同一の effectiveScrollY を渡すこと** |
| `updateSize(width?, height?)` | `void` | viewport サイズが変わった時に呼ぶ。引数省略で `window.innerWidth/Height` |
| `destroy()` | `void` | container の inline style を構築前の値に復元する |

通常は `DomSyncGL(..., { scrollSync: true })` 経由で使い、`update` / `updateSize` /
`destroy` は Core 側が自動で呼ぶ。直接 `new ScrollSync()` した場合のみ自前で繋ぐ。

## RafScroll

通常は `DomSyncGL({ scrollSync: true, rafScroll: {...} })` 経由で使うのが推奨（Core の単一 rAF に
統合され、生成順依存が無い）。自前で `new RafScroll()` する場合は **`DomSyncGL` より先に生成**しないと
背景がスクロール中に 1 フレームずれる（[Scroll Sync ガイド](/guide/scroll-sync) 参照）。

スムーズスクロールの実体は [Lenis](https://github.com/darkroomengineering/lenis) に委譲している。
`rafScroll` には Lenis のオプション（`autoRaf` を除く）をそのまま渡せる。

```ts
const app = new DomSyncGL('#canvas', {
  scrollSync: true,
  rafScroll: { lerp: 0.1 },
});
```

### Options

`RafScrollOptions` は `Omit<LenisOptions, 'autoRaf'> & { autoStart?: boolean }`。代表的なもの:

| option | type | default | 説明 |
|---|---|---|---|
| `lerp` | `number` | `0.1` | 線形補間の強度（0〜1） |
| `duration` | `number` | — | スクロールアニメーションの時間（秒）。`lerp` の代替 |
| `easing` | `(t:number)=>number` | Lenis 既定 | イージング関数 |
| `smoothWheel` | `boolean` | `true` | ホイール入力をスムージングするか |
| `syncTouch` | `boolean` | `false` | タッチ操作もスムージングするか |
| `wheelMultiplier` / `touchMultiplier` | `number` | `1` | 入力倍率 |
| `autoStart` | `boolean` | `true` | 内部 rAF ループを自走させるか。`false` は管理モード（所有者が `advance()` で駆動）。`rafScroll` オプション経由なら自動で `false` |

その他は [Lenis のオプション一覧](https://github.com/darkroomengineering/lenis#instance-settings) を参照。

### Instance members

| member | 型 | 説明 |
|---|---|---|
| `scrollY` | `number` (getter) | Lenis のスムージング後スクロール量（`lenis.scroll`） |
| `lenis` | `Lenis` (getter) | 内部 Lenis インスタンス（`scrollTo` / `on('scroll')` 等の高度操作用） |
| `advance(now?)` | `void` | 管理モード用。外部 rAF ループから 1 フレーム進める（`lenis.raf(now)`）。`autoStart: true` のときは no-op |
| `enabled` | `boolean` (getter/setter) | `false` で `lenis.stop()`（native スクロール復活）、`true` で `lenis.start()` |
| `destroy()` | `void` | Lenis を破棄し listener・ResizeObserver をすべて解放 |

### 挙動メモ

- wheel / touch の取り込み・慣性・端の扱いはすべて Lenis に委譲
- Lenis は `window` をラッパーとして実スクロールを更新するので `window.scrollY` も整合する
- 既定ではタッチはネイティブ（`syncTouch: false`）なので pull-to-refresh はそのまま動く
