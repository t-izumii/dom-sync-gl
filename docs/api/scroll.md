# Scroll

スクロール周りは `ScrollSync` の 1 クラスだけ。

| クラス | 役割 |
|---|---|
| `ScrollSync` | container を `position: absolute` で document に貼り、毎 tick で viewport に追従させる |

::: warning RafScroll は廃止された
以前あった `RafScroll`（Lenis のラッパー）は削除された。スムーズスクロールは**アプリ側の関心事**
であり、ライブラリが抱えるものではない、という整理による。Lenis を使いたい場合は
[Lenis と組み合わせる](#lenis-と組み合わせる) の形にする。`rafScroll` オプション・
`getRafScroll()` も無くなっている。
:::

## ScrollSync

通常は `new DomSyncGL(..., { scrollSync: true })` 経由で使う。直接 new することも可能。

### Options

| option | type | default | 説明 |
|---|---|---|---|
| `trackStrength` | `boolean` | `false` | `strength`（スクロール速度）の追跡を有効化 |
| `strengthDecay` | `number` | `10` | strength の指数減衰係数。大きいほど速く 0 に戻る |
| `overscan` | `number \| 'auto' \| false` | `'auto'` | canvas を viewport の上下に px 単位で広げる |
| `attach` | `'translate' \| 'dom'` | `'translate'` | container の貼り付け方。`'dom'` は container の CSS 配置を尊重する |

#### `overscan`

canvas の高さを `viewportHeight + 2 * overscan` にし、上に `-overscan` ずらす。モバイルの
URL バー伸縮で viewport 高が変わったときに、canvas の縁が欠けて見えるのを防ぐための余白。

既定の `'auto'` は `(pointer: coarse)` の環境でだけ `viewportHeight * 0.25` を確保し、
マウス環境では `0`（＝オーバーヘッドなし）になる。つまり**何も指定しなければ、タッチ端末では
対策が入り、デスクトップでは無駄が出ない**。

数値を渡すとポインタ種別に関係なくその px 数を使う。余白を完全に切りたい場合は `false`（or `0`）。

```ts
// 既定。指定しなくても同じ
new DomSyncGL('#canvas', { scrollSync: true });

// 常に 200px 確保する
new DomSyncGL('#canvas', { scrollSync: { overscan: 200 } });

// 余白なしにオプトアウトする
new DomSyncGL('#canvas', { scrollSync: { overscan: false } });
```

`window.matchMedia` が無い環境（SSR / 旧ブラウザ）では `'auto'` は `0` に落ちる。

#### `attach`

`'translate'`（既定）は container を `position: absolute` にして毎 tick
`translate3d(scrollX, effectiveScrollY, 0)` を当てる。

`'dom'` は container の CSS 配置をそのまま尊重し、position/サイズ/transform を一切上書きしない。
container が `position: fixed` なら canvas も fixed 相当で表示され、普通配置なら container 自身の
サイズで canvas が生成される。`overscan` は適用されない。既知の制限として、普通配置（非 fixed）の
container はスクロールで canvas 自体が動くため `canvasRect` が古くなり DomPlane がドリフトしうる
（fixed container なら問題ない）。

`'dom'` と組み合わせると、canvas が画面外にある間だけ描画ループを止める
[`pauseWhenOffscreen`](/api/dom-sync-gl#options) が使える。

### static `ScrollSync.computeEffectiveScrollY()`

`-document.documentElement.getBoundingClientRect().top` を返す。通常は `window.scrollY`
と同値だが、iOS Safari の上端 rubber-band 中は visual viewport offset を取り込んで負に振れる。

### Instance members

| member | 型 | 説明 |
|---|---|---|
| `logicalRect` | `DOMRect` (getter) | canvas の論理 rect。`overscan: 0` なら `(0, 0, vw, vh)` |
| `strength` | `number` (getter) | スクロール速度 (0〜1)。`trackStrength: false` の時は常に 0 |
| `enabled` | `boolean` (getter/setter) | `false` にすると `update()` が no-op になり transform 更新が止まる |
| `update(scrollX, scrollY)` | `void` | 毎 tick で呼ぶ。**plane と同一の effectiveScrollY を渡すこと** |
| `updateSize(width?, height?)` | `void` | viewport サイズが変わった時に呼ぶ |
| `destroy()` | `void` | container の inline style を構築前の値に復元する |

通常は `DomSyncGL(..., { scrollSync: true })` 経由で使い、`update` / `updateSize` /
`destroy` は Core 側が自動で呼ぶ。直接 `new ScrollSync()` した場合のみ自前で繋ぐ。

::: tip strength は trackStrength とセット
`trackStrength: false`（既定）のまま `strength` を読むと常に `0` が返る。DEV ビルドでは
一度だけ `console.warn` で知らせる。演出に使うなら必ず `{ trackStrength: true }` にすること。
:::

## Lenis と組み合わせる

ライブラリは Lenis を含まない。スムーズスクロールを入れるなら、アプリ側で Lenis を生成し、
**1 本の rAF で `lenis.raf()` → `app.tick()` の順に駆動する**。

```bash
npm install lenis
```

```ts
import { DomSyncGL } from 'dom-sync-gl';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

// どちらも自前の rAF を持たせない
const lenis = new Lenis({ autoRaf: false });
const app = new DomSyncGL('#canvas', {
  scrollSync: true,
  autoRaf: false,
});

const raf = (time: number) => {
  lenis.raf(time);   // 先にスクロールを確定させ、
  app.tick(time);    // 確定後の値で WebGL を配置する
  requestAnimationFrame(raf);
};
requestAnimationFrame(raf);
```

::: warning 2 本の rAF に分けない
`autoRaf` を両方 `true` のままにすると、Lenis と Core が**別々の rAF ループ**を持つ。ブラウザは
rAF を登録順に実行するので、Core が先に登録されていると 1 フレーム古い scrollY を読み、背景 canvas
がスクロール中だけズレる。上のように 1 本にまとめれば、登録順に関係なく順序が保証される。
:::

Lenis のオプション（`lerp` / `duration` / `smoothWheel` / `syncTouch` など）は
[Lenis のドキュメント](https://github.com/darkroomengineering/lenis#instance-settings) を参照。
既定ではタッチはネイティブのまま（`syncTouch: false`）なので、pull-to-refresh はそのまま動く。
