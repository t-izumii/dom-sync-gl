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
| `attach` | `'translate' \| 'fixed'` | `'translate'` | container の貼り付け方 |

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

## スクロール速度を演出に使う

`trackStrength: true` にすると `strength`（0〜1）が読めるようになる。速く動かすほど 1 に近づき、
止めると `strengthDecay` に従って指数的に 0 へ戻る。

```ts
const app = new DomSyncGL('#canvas', {
  scrollSync: { trackStrength: true },
});
const scrollSync = app.getScrollSync();

app.addUpdateCallback(() => {
  plane.material.uniforms.uStrength.value = scrollSync.strength;
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
