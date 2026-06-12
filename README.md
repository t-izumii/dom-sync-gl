# domSyncGL

[![npm](https://img.shields.io/npm/v/dom-sync-gl.svg)](https://www.npmjs.com/package/dom-sync-gl)
[![license](https://img.shields.io/npm/l/dom-sync-gl.svg)](./LICENSE)

DOM 要素の位置に Three.js の plane / 3D オブジェクトを貼って、スクロールに同期させつつポストエフェクトを重ねるための薄いラッパー。

## Features

- DOM 要素の bbox に追従する Three.js mesh を `createPlane(selector)` で作れる
- ネイティブスクロールと canvas のズレを毎フレーム補正する
- モバイルのタッチ慣性スクロールに対応
- `BaseEffect` を継承するだけでポストエフェクトを ping-pong で連結
- iOS Safari の動的アドレスバーに canvas 高を追従させる
- lil-gui / stats.js は optional（使うときだけ install）

## Install

```bash
npm install dom-sync-gl three
```

必須は `three` だけ。GUI パネルや FPS パネルを出したいときだけ追加:

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

`createPlane(selector)` に渡した DOM 要素の位置・サイズに追従する Three.js mesh を作る。CSS で要素が動いてもピクセル単位で付いてくる。

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

shader 側は次の uniform を宣言するだけで使える（値の更新は内部でやる）:

| uniform | 型 | 内容 |
|---|---|---|
| `uTime` | `float` | 経過秒 |
| `uResolution` | `vec2` | plane の pixel 寸法 |
| `uMouseUV` | `vec2` | hover 中の plane-local UV (0..1) |
| `uIsHovered` | `bool` | raycast hit 中か |

### Scroll sync

`scrollSync: true` を渡すと container を `position: absolute` で document に貼り、毎 rAF
で実効 scrollY を transform に流して viewport に追従させる。

実効 scrollY は `-document.documentElement.getBoundingClientRect().top` から取る。普段は
`window.scrollY` と同じ値になるが、iOS Safari の上端 rubber-band / pull-to-refresh 中は
visual viewport の offset が乗って負に振れる。この同じ値を container の transform と plane
の位置計算の両方に流しているので、rubber-band 中も canvas と DOM が同じ分だけズレて見た目が
揃う。pull-to-refresh も殺さずに済む。

```ts
const app = new WebGLApp("#canvas", {
  scrollSync: true,
});
// strength tracking を有効化
const app = new WebGLApp("#canvas", {
  scrollSync: { trackStrength: true },
});
```

`RafScroll`（rAF 同期 virtual scroll + touch 慣性）を併用すると wheel / touch の入力を rAF
tick にまとめて発火させるので、JS が読む scrollY と paint された位置がフレーム内で揃う（plane
と DOM がフレーム境界でズレにくくなる）。

**推奨は `rafScroll` オプション**。Core が RafScroll を管理下に置き、自身の単一 rAF ループ内で
`scrollTo` → `scroll 読み取り` の順に駆動するので、背景・plane が 1 フレームずれない:

```ts
const app = new WebGLApp("#canvas", {
  scrollSync: true,
  rafScroll: {
    touchFriction: 0.95,  // タッチリリース後の慣性 (0 で慣性なし)
  },
});
```

RafScroll はモバイル上端の下方向 swipe を検出したら preventDefault せず native に任せるので、
`overscroll-behavior` を `none/contain` にしていなければ pull-to-refresh はそのまま動く。

> ⚠️ `new RafScroll()` を**自前で生成して併用する**こともできるが、その場合 RafScroll と Core が
> **別々の rAF ループ**を持つ。ブラウザは rAF を登録順に実行するため、`WebGLApp` より**後に**生成
> すると Core が 1 フレーム古い scrollY を読み、背景 canvas がスクロール中だけズレる。自前生成する
> なら必ず `WebGLApp` より**先に**生成すること。順序を気にしたくなければ上記の `rafScroll` オプション
> を使う。

### Post effects

`BaseEffect` を継承して fragment shader を返すだけ。あとは `app.addEffect()` に渡すとフルスクリーンチェーンに繋がる。

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

`plane.addEffect(effect)` で plane 単位のチェーンにもできる。
`setupGUI(gui)` を実装しておくと、`showGUI: true` のときに lil-gui へコントロールが出る。

## API reference

### `new WebGLApp(selector, options?)`

| option | type | default | 説明 |
|---|---|---|---|
| `scrollSync` | `boolean \| ScrollSyncOptions` | `false` | スクロール同期を有効化 |
| `rafScroll` | `boolean \| RafScrollOptions` | `false` | RafScroll を Core 管理下で有効化（単一 rAF に統合・順序依存なし） |
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
| `autoStart` | `boolean` | `true` | 自前 rAF ループを起動するか。`false` は管理モード（所有者が `advance()` で駆動）。`WebGLApp({ rafScroll })` 経由なら自動で `false` |

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

- Chrome / Edge / Firefox / Safari の最新 2 バージョン
- iOS Safari 15.4+
- IE11 などは対象外

## Bundle

| 形式 | サイズ | gzip |
|---|---:|---:|
| ESM (`dist/index.js`) | 73.1 kB | **20.2 kB** |
| CJS (`dist/index.cjs`) | 39.4 kB | **10.1 kB** |

`three` / `lil-gui` / `stats.js` はバンドルしていない（peer dependency）。`sideEffects: false` なので tree-shaking も効く。

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
