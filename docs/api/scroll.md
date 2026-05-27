# Scroll

スクロール周りの 2 つのクラス: `ScrollSync` と `RafScroll`。
役割は別だが、両方を組み合わせて使うことが多い。

| クラス | 役割 |
|---|---|
| `ScrollSync` | container を `position: absolute` で document に貼り、毎 rAF で viewport に追従させる |
| `RafScroll` | wheel / touch を rAF tick に集約して、`window.scrollY` の更新を 1 frame に 1 回に揃える |

## ScrollSync

通常は `new WebGLApp(..., { scrollSync: true })` 経由で使う。直接 new することも可能。

### Options

| option | type | default | 説明 |
|---|---|---|---|
| `trackStrength` | `boolean` | `false` | スクロール速度の getter を有効化 |
| `strengthDecay` | `number` | `10` | strength の指数減衰係数 |

### static `ScrollSync.computeEffectiveScrollY()`

`-document.documentElement.getBoundingClientRect().top` を返す。通常は `window.scrollY`
と同値だが、iOS Safari の上端 rubber-band 中は visual viewport offset を取り込んで負に振れる。

### `instance.strength` / `instance.logicalRect`

`trackStrength: true` のときの瞬間速度 getter と、viewport の logical rect。

## RafScroll

```ts
import { RafScroll } from 'dom-sync-gl';

new RafScroll({
  touchFriction: 0.95,
});
```

### Options

| option | type | default | 説明 |
|---|---|---|---|
| `lineHeight` | `number` | `16` | `WheelEvent.deltaMode=LINE` 時の 1 行 px |
| `touchFriction` | `number` | `0.95` | タッチリリース後の慣性減衰率。`0` で慣性無効 |

### 挙動メモ

- wheel / touchmove は `preventDefault` して内部 accumulator に積む
- 毎 rAF tick で `window.scrollTo()` に流すので `window.scrollY` の更新が 1 frame に 1 回
- 端到達 / 次の touchstart / wheel 入力で慣性は即キャンセル
- モバイル上端の下方向 swipe（pull-to-refresh）は `preventDefault` しない
