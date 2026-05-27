---
layout: home

hero:
  name: domSyncGL
  text: DOM ↔ WebGL を 1 frame でつなぐ
  tagline: DOM 要素の位置に Three.js plane を貼り、スクロール同期 + ポストエフェクトを重ねる薄いラッパー
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Demos
      link: /demos/
    - theme: alt
      text: API
      link: /api/webgl-app
    - theme: alt
      text: GitHub
      link: https://github.com/t-izumii/dom-sync-gl

features:
  - title: DOM-locked plane
    details: createPlane(selector) で要素の bbox に追従する Three.js mesh を生成。CSS で動いてもピクセル単位で付いてくる。
  - title: Scroll sync
    details: ネイティブスクロールと canvas のズレを毎フレーム補正。iOS Safari の rubber-band / pull-to-refresh も殺さない。
  - title: Composable post effects
    details: BaseEffect を継承するだけで ping-pong 合成。plane 単位 / 画面全体の両方に挿せる。
---

## Live demo

DOM 要素にロックした plane に shader を流し込んだ例。

<DemoPlane />

→ コード付きの一覧は [Demos](/demos/) を参照。

## Install

```bash
npm install dom-sync-gl three
```

```ts
import { WebGLApp } from 'dom-sync-gl';

const app = new WebGLApp('#canvas');
app.createPlane('.hero-card', { fragmentShader });
```
