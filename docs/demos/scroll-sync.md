# Scroll Sync

スクロール中も DOM 要素と plane の位置がズレない例。
ここではドキュメント全体をスクロールする代わりに、ローカルの overflow scroll で挙動を見せる。

## Demo

▲ / ▼ ボタンで擬似スクロール。3 枚のカードの位置に plane がロックされ続ける。

<DemoScrollSync />

## HTML

```html
<div id="stage" style="position: relative; height: 360px; overflow: hidden;">
  <div
    id="scroller"
    style="position: absolute; inset: 0; overflow-y: auto;"
  >
    <div style="display: grid; gap: 24px; padding: 40px 16px;">
      <div data-card="0" style="height: 140px; border-radius: 12px;"></div>
      <div data-card="1" style="height: 140px; border-radius: 12px;"></div>
      <div data-card="2" style="height: 140px; border-radius: 12px;"></div>
    </div>
  </div>
</div>
```

## TypeScript

```ts
import { DomSyncGL } from 'dom-sync-gl';

const app = new DomSyncGL('#stage');

// 各カードに別 shader で plane を貼る
const colors = [
  'vec3(0.34, 0.43, 0.99)',
  'vec3(0.96, 0.34, 0.62)',
  'vec3(0.27, 0.83, 0.58)',
];

for (let i = 0; i < 3; i++) {
  app.createPlane(`[data-card="${i}"]`, {
    updateRectEveryFrame: true,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform float uTime;
      void main() {
        float g = 0.5 + 0.5 * sin(uTime + vUv.x * 6.0);
        vec3 col = ${colors[i]} * (0.6 + g * 0.4);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
```

## ポイント

### 1. なぜ `updateRectEveryFrame: true` が要るか

通常 plane は最初に取った `getBoundingClientRect()` をキャッシュして使う。
要素自体が DOM の中で動く（このデモのように親 scroller の中で位置が変わる、
GSAP / CSS animation で transform が変わる）場合だけ毎フレ取り直さないと
plane が古い位置に取り残される。

「window scroll での見た目の動き」に追従するだけなら、`updateRectEveryFrame: false`
のままでよい（plane の scene 位置は scroll snapshot から計算される）。

### 2. window scroll で使う場合

`window` 全体のスクロールに対しては `scrollSync: true` を渡す:

```ts
const app = new DomSyncGL('#stage', { scrollSync: true });
```

container を `position: absolute` で document に貼り、毎 rAF で実効 scrollY を
transform に流して viewport に追従させる。iOS Safari の rubber-band /
pull-to-refresh も殺さない（詳細は
[Guide: Scroll Sync](/guide/scroll-sync)）。

### 3. Lenis と 1 本の rAF にまとめるともっと揃う

スムーズスクロールを入れる場合、Lenis と Core の自前 rAF を両方止めて 1 本のループで
順に駆動する。JS が読む値と paint された位置がフレーム内で揃うので、plane と DOM の
1 frame ズレが消える:

```ts
import Lenis from 'lenis';

const lenis = new Lenis({ autoRaf: false });
const app = new DomSyncGL('#stage', { scrollSync: true, autoRaf: false });

const raf = (time: number) => {
  lenis.raf(time);   // 先にスクロールを確定させ、
  app.tick(time);    // 確定後の値で WebGL を配置する
  requestAnimationFrame(raf);
};
requestAnimationFrame(raf);
```

詳細は [Scroll Sync ガイド](/guide/scroll-sync#スムーズスクロール-lenis) を参照。
