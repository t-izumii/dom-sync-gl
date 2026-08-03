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
| `trackStrength` | `boolean` | `false` | `strength`（スクロール速度）の追跡を有効化 |
| `strengthDecay` | `number` | `10` | strength の指数減衰係数 |
| `overscan` | `number \| 'auto' \| false` | `'auto'` | canvas を viewport の上下に px 単位で広げる |
| `attach` | `'translate' \| 'dom'` | `'translate'` | container の貼り付け方。`'dom'` は container の CSS 配置を尊重する |

各オプションの詳細は [API: Scroll](/api/scroll) を参照。

## モバイルの URL バー対策は既定で入る

`overscan` の既定は `'auto'` で、`(pointer: coarse)` の環境でだけ canvas を上下に
`viewportHeight * 0.25` ぶん広げる。モバイルの URL バー伸縮で viewport 高が変わったときに
canvas の縁が欠けて見えるのを防ぐためで、マウス環境では `0` になるので無駄は無い。

つまり何も指定しなくてよい。切りたい場合だけ明示する。

```ts
new DomSyncGL('#canvas', {
  scrollSync: { overscan: false },
});
```

## `attach: 'dom'` で container の CSS を尊重する

既定の `'translate'` は container を viewport 全面の overlay にして毎 tick translate で追従させる。
`'dom'` にすると ScrollSync は container の position/サイズ/transform を一切上書きせず、
container 自身の CSS 配置をそのまま尊重する。canvas は container の box に出る。

- container が `position: fixed` なら、canvas も fixed 相当で表示される（ブラウザの fixed 追従に任せる）。
- 普通配置（通常フロー）の container なら、その container のサイズで canvas が生成される。

`'dom'` モードでは `overscan` は無視される。

## オフスクリーンで描画を止める

`attach: 'dom'` の canvas は container の CSS 配置をそのまま尊重するため、スクロールすると
**実際に viewport の外へ出る**。`pauseWhenOffscreen: true` を渡すと、その間だけ rAF ループを
解除して描画・DOM 読み取り・エフェクト計算をまとめて止める。

```ts
new DomSyncGL('#canvas', {
  scrollSync: { attach: 'dom' },
  pauseWhenOffscreen: true,
});
```

既定の `'translate'` では無視される（DEV では warn が出る）。translate モードは container を
毎 tick viewport へ貼り直す構造上そもそもオフスクリーンにならず、逆に**ループこそが container を
viewport に貼り付けている**ので止められない。scrollSync 無しの場合も対象外。

判定は container を見る IntersectionObserver で、`rootMargin` の既定は `'100%'`（viewport 1 枚ぶん
手前から回し始める）。`pauseRootMargin` で変えられるが、IntersectionObserver の通知は rAF callback
より**後**に配送される仕様上、復帰は最短でも 1 フレーム遅れる。`'0px'` まで詰めると復帰直後の
1 フレームが未描画で露出するので、余裕を持たせた既定のままを推奨する。

復帰時には「停止区間を挟んだせいで壊れる前フレームとの差分」を継ぎ直す:

- **時間軸** — `uTime` が停止時間ぶん飛ばず、止まったところから続く
- **スクロール速度** — `strength` が復帰初回に 1 へ張り付いてフラッシュするのを防ぐ
- **ポインタ** — `getMouseDelta()` が停止中の移動量をまとめて返さないようにする

`autoRaf: false` と併用した場合、停止中は `tick()` が no-op になる。アプリ側の rAF 自体は
止まらないので、自前の毎フレーム処理も畳みたいなら [`isPaused()`](/api/dom-sync-gl#ispaused)
を見る。

その他の挙動:

- サイズ 0 / `display: none` の container も「交差していない」と判定されるので停止する
- 構築直後は IntersectionObserver の初回通知が届くまで 0〜1 フレーム回る（初回描画がシェーダ
  コンパイルを温めるので、復帰時のヒッチが減る）
- 停止中もリサイズは適用されるが、再描画は復帰まで走らない
- 停止中は OrbitControls の damping / autoRotate も止まる
- IntersectionObserver 非対応環境では監視を張らず、従来どおり回り続ける
- タブ非表示（`document.hidden`）は扱わない。オフスクリーン判定のみ

::: warning 通常フローの container では canvasRect のドリフトとセットで効く
`pauseWhenOffscreen` が意味を持つのは「オフスクリーンになりうる container」、つまり
`position: fixed` **ではない** container だが、これは
[canvasRect のドリフト](/api/scroll#attach)が起きる条件でもある。停止の有無で挙動は変わらない
（ドリフトは最後に計測した時点に依存するため）が、併用時は両方を意識しておく。
:::

## スクロール速度を演出に使う

`trackStrength: true` にすると `strength`（0〜1）が読めるようになる。速く動かすほど 1 に近づき、
止めると `strengthDecay` に従って指数的に 0 へ戻る。

```ts
import { TSL } from 'dom-sync-gl';
const { uniform, vec3, vec4 } = TSL;

const app = new DomSyncGL('#canvas', {
  scrollSync: { trackStrength: true },
});
const scrollSync = app.getScrollSync();

// colorNode から参照する uniform ノードを自前で持ち、毎フレ値を流し込む
const uStrength = uniform(0);
const plane = app.createPlane('.card', {
  uniforms: { uStrength },
  colorNode: () => vec4(vec3(uStrength), 1), // 速いほど白く
});

app.addUpdateCallback(() => {
  uStrength.value = scrollSync.strength;
});
```

::: warning trackStrength を忘れると常に 0
既定は `false` で、そのとき `strength` は常に `0` を返す（DEV では一度だけ warn が出る）。
:::

## スムーズスクロール（Lenis）

ライブラリは Lenis を含まない。スムーズスクロールはアプリ側の関心事なので、自分で入れる。

```bash
npm install lenis
```

ポイントは、**Lenis と Core の両方の自前 rAF を止めて、1 本のループで順に駆動する**こと。

```ts
import { DomSyncGL } from 'dom-sync-gl';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

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

これで「スクロールの確定 → WebGL の配置」が必ず同一フレーム・同じ順序で起きるので、背景固定も
DOM 追従もズレない。

::: warning 2 本の rAF に分けない
`autoRaf` を両方 `true` のままにすると、Lenis と Core が**別々の rAF ループ**を持つ。ブラウザは
rAF を登録順に実行するので、Core が先に登録されていると 1 フレーム古い scrollY を読み、背景
canvas がスクロール中だけズレる。1 本にまとめれば登録順に関係なく順序が保証される。

以前あった `rafScroll` オプション（Core が Lenis を内包する形）は、この整理に伴って廃止された。
:::

### pull-to-refresh は壊さない

Lenis の既定ではタッチ操作はネイティブのまま（`syncTouch: false`）なので、モバイルの
pull-to-refresh や端のバウンスはそのまま動く。タッチもスムージングしたい場合は
`syncTouch: true` を指定する。

その他のオプションは [Lenis のドキュメント](https://github.com/darkroomengineering/lenis#instance-settings) を参照。

## Demo

→ [Demos / Scroll Sync](/demos/scroll-sync) に動くサンプルとコードを置いている。
