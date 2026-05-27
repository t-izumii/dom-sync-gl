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

### Instance members

| member | 型 | 説明 |
|---|---|---|
| `logicalRect` | `DOMRect` (getter) | viewport ぴったりの `(0, 0, vw, vh)`。canvas drawing buffer サイズに使う |
| `strength` | `number` (getter) | スクロール速度 (0〜1)。`trackStrength: false` の時は常に 0 |
| `enabled` | `boolean` (getter/setter) | `false` にすると `update()` が no-op になり transform 更新が止まる |
| `update(scrollX, scrollY)` | `void` | 毎 rAF で呼ぶ。**plane と同一の effectiveScrollY を渡すこと** |
| `updateSize(width?, height?)` | `void` | viewport サイズが変わった時に呼ぶ。引数省略で `window.innerWidth/Height` |
| `destroy()` | `void` | container の inline style を構築前の値に復元する |

通常は `WebGLApp(..., { scrollSync: true })` 経由で使い、`update` / `updateSize` /
`destroy` は Core 側が自動で呼ぶ。直接 `new ScrollSync()` した場合のみ自前で繋ぐ。

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

### Instance members

| member | 型 | 説明 |
|---|---|---|
| `scrollY` | `number` (getter) | 内部の virtual scrollY |
| `enabled` | `boolean` (getter/setter) | `false` で wheel/touch を素通しさせて native スクロール復活。再 enable 時は `window.scrollY` に再同期 |
| `destroy()` | `void` | rAF・listener・ResizeObserver をすべて解放 |

### 挙動メモ

- wheel / touchmove は `preventDefault` して内部 accumulator に積む
- 毎 rAF tick で `window.scrollTo()` に流すので `window.scrollY` の更新が 1 frame に 1 回
- 端到達 / 次の touchstart / wheel 入力で慣性は即キャンセル
- モバイル上端の下方向 swipe（pull-to-refresh）は `preventDefault` しない
