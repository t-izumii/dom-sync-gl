# domSyncGL

[![npm](https://img.shields.io/npm/v/dom-sync-gl.svg)](https://www.npmjs.com/package/dom-sync-gl)
[![license](https://img.shields.io/npm/l/dom-sync-gl.svg)](./LICENSE)

DOM 要素の位置に Three.js の plane / 3D オブジェクトを貼って、スクロールに同期させつつポストエフェクトを重ねるための薄いラッパー。

## Features

- DOM 要素の bbox に追従する Three.js mesh を `createPlane(selector)` で作れる
- `createTextPlane(selector)` で DOM のテキストを板に（スタイルは CSS 由来のまま、DOM も残る）
- ネイティブスクロールと canvas のズレを毎フレーム補正する
- `BaseEffect` を継承するだけでポストエフェクトを ping-pong で連結
- iOS Safari の動的アドレスバーに canvas 高を追従させる（`overscan`）
- rAF を自前で持てる（`autoRaf: false` + `tick()`）ので、Lenis 等と 1 本のループに統合できる
- lil-gui / stats.js は optional（使うときだけ install）

## Install

```bash
npm install dom-sync-gl three
```

必須は `three` だけ。GUI パネルや FPS パネルを出したいときだけ追加:

```bash
npm install lil-gui stats.js
```

スムーズスクロールを併用したい場合は Lenis も（ライブラリは含まない。[Scroll sync](#scroll-sync) 参照）:

```bash
npm install lenis
```

## Quick start

```html
<div id="canvas" style="position: absolute; inset: 0;"></div>
<div class="hero-card">Hello</div>
```

```ts
import { DomSyncGL } from "dom-sync-gl";

const app = new DomSyncGL("#canvas", {
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
const app = new DomSyncGL("#canvas", {
  scrollSync: true,
});

// スクロール速度 (strength) を演出に使う場合
const app = new DomSyncGL("#canvas", {
  scrollSync: { trackStrength: true },
});
```

モバイルの URL バー伸縮で canvas の縁が欠ける対策 (`overscan`) は既定 (`'auto'`) で入る。
`(pointer: coarse)` の環境でだけ上下に余白を確保し、マウス環境では 0 なので無駄は無い。
切りたい場合だけ `scrollSync: { overscan: false }` を渡す。

### スムーズスクロール (Lenis)

ライブラリは Lenis を含まない。スムーズスクロールはアプリ側の関心事として切り離してある。
入れる場合は、**Lenis と Core の両方の自前 rAF を止めて、1 本のループで順に駆動する**:

```ts
import { DomSyncGL } from "dom-sync-gl";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

const lenis = new Lenis({ autoRaf: false });
const app = new DomSyncGL("#canvas", {
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

これで「スクロールの確定 → WebGL の配置」が同一フレーム・同じ順序で起きるのでズレない。

> ⚠️ `autoRaf` を両方 `true` のままにすると Lenis と Core が**別々の rAF ループ**を持つ。
> ブラウザは rAF を登録順に実行するため、Core が先に登録されていると 1 フレーム古い scrollY を
> 読み、背景 canvas がスクロール中だけズレる。1 本にまとめれば登録順に関係なく順序が保証される。
>
> 以前あった `rafScroll` オプション / `RafScroll` クラス / `getRafScroll()` は、この整理に伴い**廃止**。

既定ではタッチはネイティブのまま (`syncTouch: false`) なので、pull-to-refresh はそのまま動く。

### DOM text plane

`createTextPlane(selector)` は DOM 要素のテキストを canvas に焼いて板に貼る。スタイルは
`getComputedStyle` 由来なので `font-size: clamp(...)` のような fluid 指定もそのまま解決される。

```ts
app.createTextPlane(".headline", { updateRectEveryFrame: true });
```

元の DOM テキストは `color: transparent` になるだけで消えない。レイアウト・スクリーンリーダー・
テキスト選択・SEO はそのまま残り、見た目だけが WebGL に差し替わる。

Web フォントを動的に読む場合は `loadFont()` の解決を待ってから板を作る（フォントの取得・登録は
`DomTextPlane` の責務ではなく、独立ユーティリティの責務として分けてある）:

```ts
import { loadFont } from "dom-sync-gl";

const ready = loadFont({ family: "SpaceMono", url: "/fonts/space-mono.woff2" });
ready.then(() => app.createTextPlane(".headline"));
```

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
`setupGUI(gui)` を実装しておくと、`gui` オプションに lil-gui インスタンスを渡したときだけ
コントロールが出る。

## API reference

### `new DomSyncGL(selector, options?)`

| option | type | default | 説明 |
|---|---|---|---|
| `scrollSync` | `boolean \| ScrollSyncOptions` | `false` | スクロール同期を有効化 |
| `autoRaf` | `boolean` | `true` | 内部 rAF ループを回すか。`false` なら自前の rAF から `tick()` で駆動 |
| `enablePointerTracking` | `boolean` | `true` | ポインタ座標と hover 判定を更新 |
| `maxPixelRatio` | `number` | `2` | `renderer.setPixelRatio` の上限 (モバイルは `1.5` 推奨) |
| `outputColorSpace` | `THREE.ColorSpace` | `SRGBColorSpace` | renderer の出力色空間 |
| `stats` | `Stats \| null` | `null` | 呼び出し元が生成した stats.js インスタンス |
| `gui` | `GUI \| null` | `null` | 呼び出し元が生成した lil-gui インスタンス |

> `stats` / `gui` は**インスタンスを渡す**方式。生成・DOM への挿入・破棄はすべて呼び出し元の責務で、
> ライブラリは受け取ったものを使うだけ。以前の `showStats` / `showGUI` / `statsParent` / `guiTitle` は**廃止**。
> `enableMouseTracking` / `setMouseTrackingEnabled()` は `enablePointerTracking` 系の別名として残っている。

#### Main methods

- `createPlane(selector, options?)` — DOM 要素にロックした plane を生成 (`selector` が `null` だと全画面背景)
- `createTextPlane(selector, options?)` — DOM のテキストを焼いた plane を生成
- `create3DObject(selector, options)` — GLTF モデルを DOM 要素にフィット
- `tick(time?)` — 1 フレーム進める (`autoRaf: false` のとき自前の rAF から呼ぶ)
- `addEffect(effect)` / `removeEffect(effect)` — フルスクリーンチェーンの管理
- `addObject(obj3d)` / `removeObject(obj3d)` — シーンに直接追加
- `addUpdateCallback(fn)` — 毎フレ呼ばれるコールバック登録 (unsubscribe 関数を返す)
- `addResizeCallback(fn)` — リサイズ時のコールバック登録
- `getScene()` / `getCamera()` / `getRenderer()` / `getMouse()` / `getScrollSync()` — 内部インスタンスへのアクセス
- `destroy()` — リスナー・テクスチャ・RT をすべて解放

### `ScrollSyncOptions`

| option | type | default | 説明 |
|---|---|---|---|
| `trackStrength` | `boolean` | `false` | `strength` (スクロール速度) の追跡を有効化 |
| `strengthDecay` | `number` | `10` | strength の指数減衰係数 |
| `overscan` | `number \| 'auto' \| false` | `'auto'` | canvas を viewport の上下に px 単位で広げる。`'auto'` は coarse pointer でのみ `vh * 0.25`、マウス環境では 0。切るなら `false` |
| `attach` | `'translate' \| 'fixed'` | `'translate'` | container の貼り付け方 |

> `trackStrength: false` のまま `strength` を読むと常に `0`（DEV では一度だけ warn）。

### `CreateTextPlaneOptions`

`CreatePlaneOptions` を継承し、以下が追加される:

| option | type | default | 説明 |
|---|---|---|---|
| `text` | `string` | `element.textContent` | 代わりに描画するテキスト |
| `style` | `TextStyleOverrides` | `{}` | `getComputedStyle` の抽出結果を個別に上書き |
| `pixelRatio` | `number` | `min(devicePixelRatio, 2)` | canvas の解像度倍率 |
| `hideElementText` | `boolean` | `true` | 元 DOM テキストを `color: transparent` で隠すか |

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
  DomSyncGL, Camera, Light, DomPlane, DomTextPlane, Dom3DObject,
  // Scroll
  ScrollSync,
  // Text
  loadFont, resolveTextStyle, layoutLines, rasterizeText,
  // Post effects
  EffectComposer, EffectPass, PlaneComposer, BaseEffect, FeedbackBuffer,
  // Extension base
  BaseScene,
  // Utility
  DomPositionCalculator,
  // Three.js を再 export (利用側で別途 import 不要)
  THREE,
} from "dom-sync-gl";

import type {
  DomSyncGLOptions,
  CreatePlaneOptions,
  CreateTextPlaneOptions,
  TextStyleOverrides,
  ResolvedTextStyle,
  FontFaceSource,
  Create3DObjectOptions,
  Dom3DObjectFitMode,
  Offset3D,
  DOMPositionInfo,
  ScrollSyncOptions,
  PointerType,
  BaseEffectConfig,
  EffectOptions,
  EffectTarget,
  EffectLike,
  FeedbackBufferOptions,
  FeedbackInput,
  AddFeedbackOptions,
} from "dom-sync-gl";
```

## Browser support

- Chrome / Edge / Firefox / Safari の最新 2 バージョン
- iOS Safari 15.4+
- IE11 などは対象外

## Bundle

| 形式 | サイズ | gzip |
|---|---:|---:|
| ESM (`dist/index.js`) | 62.8 kB | **15.1 kB** |
| CJS (`dist/index.cjs`) | 49.0 kB | **13.0 kB** |

`three` / `lil-gui` / `stats.js` はバンドルしていない（peer dependency）。`sideEffects: false` なので tree-shaking も効く。
Lenis もランタイム依存には含まない（使う場合はアプリ側で install する）。

## Develop

```bash
npm install
npm run dev        # docs/ を vitepress で起動
npm run example    # example/ を vite で起動 (http://localhost:5180)
npm run build      # dist/ にビルド
npm run test       # vitest
npm run typecheck  # ライブラリ本体 (src/)
```

## License

MIT
