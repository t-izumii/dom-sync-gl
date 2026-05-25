# domSyncGL

[![npm](https://img.shields.io/npm/v/dom-sync-gl.svg)](https://www.npmjs.com/package/dom-sync-gl)
[![license](https://img.shields.io/npm/l/dom-sync-gl.svg)](./LICENSE)

DOM 要素にロックした Three.js plane / 3D オブジェクトを描画し、スクロールに完璧同期させて、ポストエフェクトをチェーンする — そのための薄いレイヤーです。

## Features

- **DOM-locked plane / 3D object** — 任意の DOM 要素の bbox に追従する Three.js mesh を 1 行で生成
- **スクロール同期** — ネイティブスクロールと canvas が 1 frame もズレない
- **タッチ慣性スクロール** — モバイルでも native 感覚の慣性が効く
- **チェーン可能なポストエフェクト** — `BaseEffect` を継承するだけで ping-pong 合成
- **iOS Safari 対応** — 動的アドレスバーで canvas 高がずれない
- **lil-gui / stats.js は optional** — 使うときだけ install すれば良い

## Install

```bash
npm install dom-sync-gl three
```

`three` のみ必須。GUI パネルや FPS パネルを使う場合のみ追加:

```bash
npm install lil-gui stats.js
```

## Quick start

```html
<div id="canvas" style="position: absolute; inset: 0;"></div>
<div class="hero-card">Hello</div>
```

```ts
import { WebGLApp } from "dom-sync-gl";

const app = new WebGLApp("#canvas", {
  scrollSync: true,
});

// .hero-card 要素にロックした plane
app.createPlane(".hero-card", {
  fragmentShader: `
    precision highp float;
    varying vec2 vUv;
    uniform float uTime;
    void main() {
      gl_FragColor = vec4(vUv, 0.5 + 0.5 * sin(uTime), 1.0);
    }
  `,
});

// 全画面背景レイヤとして使う
app.createPlane(null, {
  fragmentShader: bgShader,
});
```

## Concepts

### DOM-locked plane

`createPlane(selector)` で指定した DOM 要素の位置・サイズに追従する Three.js mesh を作る。CSS で要素が動いてもピクセル単位で追従する。

```ts
const plane = app.createPlane(".card", {
  fragmentShader,
  updateRectEveryFrame: true,  // CSS animation / GSAP で動く要素用
  uniforms: {
    uTexture: { value: texture },
    uIntensity: { value: 0.5 },
  },
  onInView: (p) => (p.material.uniforms.uIntensity.value = 1),
});
```

shader 側では以下の uniform が宣言だけで使える (更新は自動):

| uniform | 型 | 内容 |
|---|---|---|
| `uTime` | `float` | 経過秒 |
| `uResolution` | `vec2` | plane の pixel 寸法 |
| `uMouseUV` | `vec2` | hover 中の plane-local UV (0..1) |
| `uIsHovered` | `bool` | raycast hit 中か |

### Scroll sync

`scrollSync: true` を渡すと、container を `position: absolute` で document に貼り、毎 rAF
で実効 scrollY を transform に流して viewport に追従させる。

実効 scrollY は `-document.documentElement.getBoundingClientRect().top` から算出する。
通常スクロール中は `window.scrollY` と一致するが、iOS Safari の上端 rubber-band /
pull-to-refresh 中は visual viewport offset を取り込んで負に振れる。同じ実効 scrollY を
container transform と plane 位置計算に同値で流すことで、rubber-band 中も canvas と DOM
が同じ視覚オフセットを共有して揃い、ネイティブの引っ張ってリロードを殺さない。

```ts
const app = new WebGLApp("#canvas", {
  scrollSync: true,
});
// strength tracking を有効化
const app = new WebGLApp("#canvas", {
  scrollSync: { trackStrength: true },
});
```

`RafScroll` を併用すると、wheel / touch の入力を rAF tick に集約して、scrollY が JS と
paint で完全に同値になる (= plane 位置と DOM の見た目が 1 frame もズレない):

```ts
import { RafScroll } from "dom-sync-gl";

new RafScroll({
  touchFriction: 0.95,  // タッチリリース後の慣性 (0 で慣性なし)
});
```

RafScroll はモバイル上端での下方向 swipe を検出すると preventDefault せず native に委ねる
ので、`overscroll-behavior` を `none/contain` にしなければ pull-to-refresh はそのまま使える。

### Post effects

`BaseEffect` を継承して fragment shader を返すだけ。`app.addEffect()` でフルスクリーンチェーンに自動配線される。

```ts
import { BaseEffect, type BaseEffectConfig } from "dom-sync-gl";

class GrainEffect extends BaseEffect {
  protected getConfig(): BaseEffectConfig {
    return {
      fragmentShader: `
        precision highp float;
        uniform sampler2D tDiffuse;
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          vec4 src = texture2D(tDiffuse, vUv);
          float g = fract(sin(dot(vUv + uTime, vec2(12.9898, 78.233))) * 43758.5453);
          gl_FragColor = vec4(src.rgb + (g - 0.5) * 0.06, src.a);
        }
      `,
      uniforms: { uTime: { value: 0 } },
    };
  }
  update(time: number) {
    this.setUniform("uTime", time);
  }
}

app.addEffect(new GrainEffect());
```

`plane.addEffect(effect)` で plane 単位のエフェクトチェーンにもできる。
`setupGUI(gui)` を実装したエフェクトは、`showGUI: true` のとき lil-gui に自動でコントロールが出る。

## API reference

### `new WebGLApp(selector, options?)`

| option | type | default | 説明 |
|---|---|---|---|
| `scrollSync` | `boolean \| ScrollSyncOptions` | `false` | スクロール同期を有効化 |
| `enableMouseTracking` | `boolean` | `true` | マウス座標と hover 判定を更新 |
| `maxPixelRatio` | `number` | `2` | `renderer.setPixelRatio` の上限 (モバイルは `1.5` 推奨) |
| `outputColorSpace` | `THREE.ColorSpace` | `SRGBColorSpace` | renderer の出力色空間 |
| `showStats` | `boolean` | `false` | stats.js の FPS パネルを表示 |
| `statsParent` | `HTMLElement` | `document.body` | パネルの append 先 |
| `showGUI` | `boolean` | `true` | `setupGUI()` を実装したエフェクトに lil-gui を渡す |
| `guiTitle` | `string` | `'Effects'` | lil-gui ルートタイトル |

#### Main methods

- `createPlane(selector, options?)` — DOM 要素にロックした plane を生成 (`selector` が `null` だと全画面背景)
- `create3DObject(selector, options)` — GLTF モデルを DOM 要素にフィット
- `addEffect(effect)` / `removeEffect(effect)` — フルスクリーンチェーンの管理
- `addObject(obj3d)` / `removeObject(obj3d)` — シーンに直接追加
- `addUpdateCallback(fn)` — 毎フレ呼ばれるコールバック登録 (unsubscribe 関数を返す)
- `addResizeCallback(fn)` — リサイズ時のコールバック登録
- `getScene()` / `getCamera()` / `getRenderer()` / `getMouse()` — 内部インスタンスへのアクセス
- `destroy()` — リスナー・テクスチャ・RT をすべて解放

### `ScrollSyncOptions`

| option | type | default | 説明 |
|---|---|---|---|
| `trackStrength` | `boolean` | `false` | スクロール速度の getter を有効化 |
| `strengthDecay` | `number` | `10` | strength の指数減衰係数 |

### `RafScrollOptions`

| option | type | default | 説明 |
|---|---|---|---|
| `lineHeight` | `number` | `16` | `WheelEvent.deltaMode=LINE` 時の 1 行 px |
| `touchFriction` | `number` | `0.95` | タッチリリース後の慣性減衰率。`0` で慣性無効 |

### `CreatePlaneOptions`

| option | type | default | 説明 |
|---|---|---|---|
| `vertexShader` / `fragmentShader` | `string` | デフォルト passthrough | shader ソース |
| `uniforms` | `{ [key]: IUniform }` | `{}` | ユーザー定義 uniform |
| `updateRectEveryFrame` | `boolean` | `false` | 毎フレ bbox を取り直す |
| `segments` | `number` | `1` | PlaneGeometry セグメント数 |
| `onInView` / `onOutView` | `(plane) => void` | — | IntersectionObserver コールバック |
| `inViewRootMargin` | `string` | `'100%'` | IO の rootMargin |
| `inViewRepeat` | `boolean` | `false` | `true` で出入りのたび `onInView` が発火 |
| `crossOrigin` | `string` | `'anonymous'` | `data-texture` 読み込み時の CORS 属性 |

### Exports

```ts
import {
  // Core
  WebGLApp, Camera, Light, DomPlane, Dom3DObject,
  // Scroll
  ScrollSync, RafScroll,
  // Post effects
  EffectComposer, EffectPass, PlaneComposer, BaseEffect,
  // Extension base
  BaseScene,
  // Utility
  DomPositionCalculator,
  // Three.js を再 export (利用側で別途 import 不要)
  THREE,
} from "dom-sync-gl";

import type {
  WebGLAppOptions,
  CreatePlaneOptions,
  Create3DObjectOptions,
  Dom3DObjectFitMode,
  Offset3D,
  DOMPositionInfo,
  ScrollSyncOptions,
  RafScrollOptions,
  BaseEffectConfig,
  EffectOptions,
  EffectTarget,
  EffectLike,
} from "dom-sync-gl";
```

## Browser support

- Modern evergreen (Chrome / Edge / Firefox / Safari の各最新 2 バージョン)
- iOS Safari 15.4+
- IE11 等のレガシーブラウザは対象外

## Bundle

| 形式 | サイズ | gzip |
|---|---:|---:|
| ESM (`dist/index.js`) | 73.1 kB | **20.2 kB** |
| CJS (`dist/index.cjs`) | 39.4 kB | **10.1 kB** |

`three` / `lil-gui` / `stats.js` はバンドルされない (peer dependency)。`sideEffects: false` で tree-shaking 可。

## Develop

```bash
npm install
npm run dev        # examples/basic/ を vite で起動
npm run build      # dist/ にビルド
npm run test       # vitest
npm run typecheck
```

## License

MIT
