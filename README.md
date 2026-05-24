# domSyncGL

[![npm](https://img.shields.io/npm/v/dom-sync-gl.svg)](https://www.npmjs.com/package/dom-sync-gl)
[![license](https://img.shields.io/npm/l/dom-sync-gl.svg)](./LICENSE)

DOM 要素にロックした Three.js plane / 3D オブジェクト、スクロール同期、チェーン可能なポストエフェクト、touch 慣性付きの virtual scroll を、Three.js を peer dependency にした単一パッケージにまとめたもの。

> npm パッケージ名は **`dom-sync-gl`** (kebab-case)、display 名は **`domSyncGL`** (camelCase)。

## Features

- **DOM-locked rendering** — 任意の DOM 要素の bbox に追従する `DomPlane` / `Dom3DObject`。CSS で動かしてもピクセル単位で追従。
- **rAF↔paint scroll sync** — `ScrollSync` + `RafScroll` で paint 時にも desync しない。
- **Touch inertia** — `RafScroll` がモバイル touch に対して native と同等の慣性スクロールを自前で再現 (`touchFriction` で減衰率カスタマイズ可)。
- **Composable post effects** — `BaseEffect` を継承して `fragmentShader` を返すだけで ping-pong チェーンに自動配線。`enabled` で個別に on/off。
- **iOS Safari friendly** — `100lvh` / `visualViewport.resize` 対応で動的アドレスバーに canvas 高が引きずられない。
- **Mobile tier-ing pattern** — `maxPixelRatio` で renderer のピクセル密度を絞れる。fbm オクターブ等の shader 軽量化はアプリ側で template literal 分岐 (example 参照)。

## Install

```bash
npm install dom-sync-gl three
# 任意 (GUI panel / FPS panel を使う時だけ)
npm install lil-gui stats.js
```

`three` のみ必須 peer。`lil-gui` / `stats.js` は **`peerDependenciesMeta` で optional 宣言** + 内部で **dynamic import** なので、`showGUI: false` / `showStats: false`（または未指定）のときは追加 install 不要、bundle にも入りません。

`showGUI: true` で effect を addEffect すると、初回だけ lil-gui を async load してから `setupGUI()` を呼ぶ流れになります (load 中に effect を複数 addEffect しても load promise を共有して 1 インスタンスにまとまる)。

## Quick start

最低限のセットアップ:

```ts
import { WebGLApp } from "dom-sync-gl";

const app = new WebGLApp("#canvas", {
  scrollSync: true,
});

// DOM 要素にロックした plane
app.createPlane(".hero-card", {
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform float uTime;
    void main() {
      gl_FragColor = vec4(vUv, 0.5 + 0.5 * sin(uTime), 1.0);
    }
  `,
});

// element=null で全画面 plane (背景レイヤ)
app.createPlane(null, {
  fragmentShader: /* ... */,
});
```

HTML 側に canvas slot を置く:

```html
<div id="canvas" style="position: absolute; top: 0; left: 0; width: 100vw; height: 100svh;"></div>
```

`ScrollSync` が container の元 CSS rect を snapshot して以降の resize でも比率を保つので、`height: 100svh` (アドレスバー込みの小さい viewport) のような指定がそのまま尊重される。

## Concepts

### 1. DOM-locked plane

`createPlane(selector)` で渡した DOM 要素の `getBoundingClientRect()` を毎フレーム読み、対応する Three.js mesh の world 位置とスケールを更新する。**transform で動く要素** (CSS animation, GSAP 等) は `updateRectEveryFrame: true` を指定すると毎フレ取り直す。

```ts
const plane = app.createPlane(".card", {
  fragmentShader,
  updateRectEveryFrame: true,
  uniforms: {
    // 組み込み uniform (uTime / uResolution / uMouseUV / uIsHovered) は
    // 宣言不要で shader 側に届く。ここに書くのはユーザー定義 uniform のみ。
    uTexture: { value: texture },
    uIntensity: { value: 0.5 },
  },
  onInView: (p) => p.material.uniforms.uIntensity.value = 1,
});
```

組み込み uniform (shader 側で `uniform xxx` と書くだけで使える、宣言・更新不要):
- `uTime` (`float`, 秒) — `clock.getElapsedTime()` を毎フレ書き込み
- `uResolution` (`vec2`) — plane の pixel 寸法 (resize / rect 更新時に追従)
- `uMouseUV` (`vec2`, 0..1) — hover 中の plane-local UV 座標
- `uIsHovered` (`bool`) — raycast hit 中か

### 2. Scroll sync

`scrollSync: true` を有効にすると、canvas container が `position: absolute; top:0; left:0` に置き換わり、毎 rAF で 1 回読んだ `window.scrollY` を:
- container 自身の `transform: translate3d(0, scrollY, 0)`
- 各 `DomPlane` の sceneY 計算

の両方に **同じ値で配る**。paint と JS rAF の間で scrollY が変わっても、container も plane も同じ「古い値」で揃ってズレるので、視覚上は DOM ↔ mesh が完璧に一致する。

`RafScroll` を併用すると `window.scrollY` の更新自体が rAF tick 上だけになり、native scroll の rAF↔paint Δ も消える:

```ts
import { RafScroll } from "dom-sync-gl";

const rafScroll = new RafScroll({
  touchFriction: 0.95,  // touch リリース後の慣性減衰 (0 = 慣性なし)
});
// rafScroll は constructor で wheel/touch を listen 開始する
```

### 3. Post effects

`BaseEffect` を継承し `getConfig()` で fragment shader を返すだけ:

```ts
import { BaseEffect, type BaseEffectConfig } from "dom-sync-gl";

class GrainEffect extends BaseEffect {
  protected getConfig(): BaseEffectConfig {
    return {
      fragmentShader: /* glsl */ `
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
  update(time: number) { this.setUniform("uTime", time); }
}

app.addEffect(new GrainEffect());
```

`app.addEffect()` でフルスクリーンチェーンに追加、`plane.addEffect()` で per-plane に追加できる (同じインスタンスは片方だけ)。

`setupGUI(gui)` を実装すると `showGUI: true` のとき lil-gui パネルに自動で controls が出る。

## API reference

### `new WebGLApp(selector, options?)`

| option | type | default | 説明 |
|---|---|---|---|
| `scrollSync` | `boolean \| ScrollSyncOptions` | `false` | `true`  ON、object でパラメータ指定 |
| `enableMouseTracking` | `boolean` | `true` | mousemove で uMouseUV / raycast を更新 |
| `maxPixelRatio` | `number` | `2` | `renderer.setPixelRatio` の上限 (モバイルは `1.5` 推奨) |
| `outputColorSpace` | `THREE.ColorSpace` | `SRGBColorSpace` | renderer の出力色空間 |
| `showStats` | `boolean` | `false` | stats.js FPS パネル表示 |
| `statsParent` | `HTMLElement` | `document.body` | パネル append 先 |
| `showGUI` | `boolean` | `true` | effect の `setupGUI()` を自動呼び出し |
| `guiTitle` | `string` | `'Effects'` | lil-gui ルートタイトル |

#### Main methods

- `createPlane(selector, options?)` → `DomPlane`。`selector` が `null` だと全画面背景 plane。
- `create3DObject(selector, options)` → `Dom3DObject` (GLTF を DOM bbox に fit)。
- `addEffect(effect)` / `removeEffect(effect)` — フルスクリーンチェーン
- `addObject(obj3d)` / `removeObject(obj3d)` — Three.js scene に直接追加
- `addUpdateCallback(fn)` → unsubscribe 関数。rAF tick ごとに呼ばれる。
- `addResizeCallback(fn)` → unsubscribe 関数
- `setMouseTrackingEnabled(bool)` — 動的に on/off
- `getScene() / getCamera() / getRenderer() / getMouse()`
- `destroy()` — 全 listener / RT / scene を解放

### `ScrollSyncOptions`

| option | type | default | 説明 |
|---|---|---|---|
| `padding` | `number` | `0` | 上下パディング比率 (canvas 高 = viewport × (1 + 2·padding))。`0` で CSS rect そのまま |
| `trackStrength` | `boolean` | `false` | スクロール強度 getter を有効化 |
| `strengthDecay` | `number` | `10` | strength の指数減衰係数 |

### `RafScrollOptions`

| option | type | default | 説明 |
|---|---|---|---|
| `lineHeight` | `number` | `16` | `WheelEvent.deltaMode=LINE` 時の 1 行 px |
| `touchFriction` | `number` | `0.95` | touch リリース後の慣性減衰率 (16.67ms 換算 1 フレあたりの velocity 乗算値、`0` で慣性無効) |

### `CreatePlaneOptions`

| option | type | default | 説明 |
|---|---|---|---|
| `vertexShader` / `fragmentShader` | `string` | (default passthrough) | shader ソース |
| `uniforms` | `{ [key]: IUniform }` | `{}` | 追加 uniform。組み込み (`uTime` 等) と衝突しないよう |
| `updateRectEveryFrame` | `boolean` | `false` | 毎フレ bbox 取り直し (CSS animation で動く要素用) |
| `segments` | `number` | `1` | PlaneGeometry セグメント数 (頂点 displacement する場合のみ増やす) |
| `onInView` / `onOutView` | `(plane) => void` | — | IntersectionObserver コールバック |
| `inViewRootMargin` | `string` | `'100%'` | IO の rootMargin |
| `inViewRepeat` | `boolean` | `false` | 出入りのたびに onInView を発火 |
| `crossOrigin` | `string` | `'anonymous'` | `data-texture` 読み込み時の CORS 属性 |

### Exports

```ts
// Core
export { WebGLApp, Camera, Light, DomPlane, Dom3DObject };

// Scroll
export { ScrollSync, RafScroll };

// Post effects
export { EffectComposer, EffectPass, PlaneComposer, BaseEffect };

// Extension base
export { BaseScene };

// Utility
export { DomPositionCalculator };

// Types
export type {
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
};

// Re-export THREE (利用側で `import * as THREE from "three"` する代わりに使える)
export { THREE };
```

## Browser support

- Modern evergreen (Chrome / Edge / Firefox / Safari の各最新 2 バージョン)
- **iOS Safari 15.4+** (`100lvh` / `visualViewport` を使う)
- WebGL2 は不要 (WebGL1 で動く)
- IE11 等のレガシーブラウザは対象外

## Bundle

| 形式 | ファイル | minified | gzipped |
|---|---|---:|---:|
| ESM | `dist/index.js` | 73.1 kB | **20.2 kB** |
| CJS | `dist/index.cjs` | 39.4 kB | **10.1 kB** |

- 型定義: `dist/index.d.ts` + 各ファイル `*.d.ts` をそのまま投影 (`rollupTypes: false`)
- `sideEffects: false` で tree-shaking 可
- `three` / `lil-gui` / `stats.js` はバンドルに含まれない (peer + dynamic import)
- `three` 本体 (~600 kB) は利用側で持ち込み

## Develop

```bash
npm install
npm run dev      # examples/basic/ を vite で立ち上げる
npm run build    # dist/ にビルド
npm run test     # vitest 実行
npm run typecheck
```

`examples/` は npm publish 物には含まれない (`files: ["dist"]`)。

## License

MIT
