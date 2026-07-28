---
layout: home

hero:
  name: domSyncGL
  text: DOM ↔ GPU を 1 frame でつなぐ
  tagline: DOM 要素の位置に Three.js plane を貼り、スクロール同期 + TSL ポストエフェクトを重ねる薄いラッパー。WebGPU 既定・WebGL 2 自動フォールバック。
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Demos
      link: /demos/
    - theme: alt
      text: API
      link: /api/dom-sync-gl
    - theme: alt
      text: GitHub
      link: https://github.com/t-izumii/dom-sync-gl

features:
  - title: DOM-locked plane
    details: createPlane(selector) で要素の bbox に追従する Three.js mesh を生成。CSS で動いてもピクセル単位で付いてくる。
  - title: WebGPU / WebGL 2 自動フォールバック
    details: 既定で WebGPU、非対応環境では WebGL 2 に自動で切り替え。シェーダーは TSL で書くので 1 実装で WGSL / GLSL 両対応。
  - title: Scroll sync
    details: ネイティブスクロールと canvas のズレを毎フレーム補正。iOS Safari の rubber-band / pull-to-refresh も殺さない。
  - title: Text planes
    details: createTextPlane() で DOM のテキストを板に。スタイルは CSS 由来のまま、DOM も残るのでレイアウト・a11y・選択は壊さない。
  - title: Composable post effects
    details: BaseEffect を継承して TSL の outputNode を返すだけで ping-pong 合成。plane 単位 / 画面全体の両方に挿せる。
---

## Live demo

DOM 要素にロックした plane に TSL シェーダーを流し込んだ例。

<DemoPlane />

→ コード付きの一覧は [Demos](/demos/) を参照。

## Install

```bash
npm install dom-sync-gl three
```

```ts
import { DomSyncGL, TSL } from 'dom-sync-gl';
const { vec4, sin } = TSL;

const app = new DomSyncGL('#canvas');

app.createPlane('.hero-card', {
  colorNode: ({ uv, uTime }) => vec4(uv, sin(uTime).mul(0.5).add(0.5), 1),
});
```
