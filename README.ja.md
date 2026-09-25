# domSyncGL

[![npm](https://img.shields.io/npm/v/dom-sync-gl.svg)](https://www.npmjs.com/package/dom-sync-gl)
[![license](https://img.shields.io/npm/l/dom-sync-gl.svg)](./LICENSE)

[English](./README.md) | 日本語

DOM 要素の位置に Three.js の plane / 3D オブジェクトを貼って、スクロールに同期させつつ TSL ベースのポストエフェクトを重ねるための薄いラッパー。WebGPU 既定・WebGL 2 自動フォールバック。

## Features

- DOM 要素の bbox に追従する Three.js mesh を `createPlane(selector)` で作れる
- レンダラーは `three/webgpu` の `WebGPURenderer`。WebGPU 非対応環境では WebGL 2 に自動フォールバックし、シェーダーは TSL で書くので 1 実装で WGSL / GLSL 両対応
- `createTextPlane(selector)` で DOM のテキストを板に（スタイルは CSS 由来のまま、DOM も残る）
- ネイティブスクロールと canvas のズレを毎フレーム補正する
- `BaseEffect` を継承して TSL の `outputNode` を返すだけでポストエフェクトを ping-pong で連結
- iOS Safari の動的アドレスバーに canvas 高を追従させる（`overscan`）
- rAF を自前で持てる（`autoRaf: false` + `tick()`）ので、Lenis 等と 1 本のループに統合できる
- canvas が画面外にある間は描画ループごと止められる（`pauseWhenOffscreen`）
- lil-gui / stats.js は optional（使うときだけ install）

## Install

```bash
npm install dom-sync-gl three
```

必須は `three`（**0.181.x / 0.182.x**。内部で `three/webgpu` / `three/tsl` エントリポイントを使う）だけ。
TSL は three の版ごとに API が変わるため、CI で動作を確認した範囲だけを peerDependency に指定している。
GUI パネルや FPS パネルを出したいときだけ追加:

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
import { DomSyncGL, TSL } from "dom-sync-gl";
const { vec4, sin } = TSL;

const app = new DomSyncGL("#canvas", {
  scrollSync: true,
});

// .hero-card 要素にロックした plane
app.createPlane(".hero-card", {
  colorNode: ({ uv, uTime }) =>
    vec4(uv, sin(uTime).mul(0.5).add(0.5), 1),
});

// 全画面背景レイヤとして使う
app.createPlane(null, {
  colorNode: bgNode,
});
```

## Concepts

### WebGPU first / WebGL 2 fallback

renderer は `three/webgpu` の `WebGPURenderer`。WebGPU が使える環境では WebGPU、使えない環境では
WebGL 2 バックエンドに自動フォールバックする。シェーダーは GLSL 文字列ではなく **TSL のノードファクトリ**
で書き、three が WGSL / GLSL へ自動変換するので利用側は 1 実装だけ書けばよい。

WebGPU の device 取得は非同期なので、初期化完了は `app.ready`（Promise）で待てる。

```ts
const app = new DomSyncGL("#canvas");
await app.ready; // 待たなくても安全（初期化完了まで render が no-op になるだけ）

app.isWebGPUBackend(); // WebGL 2 フォールバック時は false（ready 解決前も false）
```

デバッグ用に WebGL 2 バックエンドを強制する `forceWebGL: true` オプションもある。

### DOM-locked plane

`createPlane(selector)` に渡した DOM 要素の位置・サイズに追従する Three.js mesh を作る。ページのスクロールにはピクセル単位で付いてくる。

> [!IMPORTANT]
> 要素の位置とサイズ（`getBoundingClientRect()`）は、性能のため**既定ではリサイズ時にしか測り直さない**。
> GSAP・CSS animation・transition などで要素そのものを動かすと、plane は元の位置に残る。
> 動く要素には `updateRectEveryFrame: true` を付けること。
>
> | 要素の動き方 | 既定で追従するか |
> |---|---|
> | ページのスクロール | する |
> | window / container のリサイズ | する（100ms の debounce 後） |
> | `position: sticky` の要素 | する（自動で毎フレーム測り直す） |
> | transform / top / left のアニメーション、親要素の中でのスクロール | **しない** → `updateRectEveryFrame: true` |
> | レイアウトの変化（要素の追加・削除、フォント読み込みなど） | **しない** → `updateRectEveryFrame: true` か `app.resize()` |
>
> `updateRectEveryFrame` は plane ごとに毎フレーム layout を読むので、動く要素にだけ付ける。

```ts
import { TSL } from "dom-sync-gl";
const { uniform } = TSL;

const uIntensity = uniform(0.5);
const plane = app.createPlane(".card", {
  colorNode,
  updateRectEveryFrame: true,  // CSS animation / GSAP で動く要素用
  uniforms: { uIntensity },    // 自前の uniform ノード（ctx.uniforms から参照できる）
  onInView: () => (uIntensity.value = 1),
});
```

`colorNode` / `positionNode` ファクトリの引数（ctx）には、宣言不要で使えるノードが渡ってくる
（値の更新は内部でやる）:

| ノード | 型 | 内容 |
|---|---|---|
| `uTime` | `UniformNode<number>` | 経過秒 |
| `uResolution` | `UniformNode<Vector2>` | plane の pixel 寸法 |
| `uMouseUV` | `UniformNode<Vector2>` | hover 中の plane-local UV (0..1) |
| `uIsHovered` | `UniformNode<number>` | raycast hit 中なら 1 / それ以外 0 |
| `uTexture` | `TextureNode` | `data-texture` 属性 or `setTexture()` のテクスチャ |
| `uv` | `Node` | UV ノード |

`data-texture` で読むテクスチャの色空間の既定は `SRGBColorSpace`（NodeMaterial が画面出力時に
linear→sRGB 変換を行うため、DOM の画像と表示が一致する）。生の値を素通ししたい場合のみ
`textureColorSpace: THREE.NoColorSpace` を指定する。

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

`BaseEffect` を継承して TSL の `outputNode` ファクトリを返すだけ。あとは `app.addEffect()` に渡すとフルスクリーンチェーンに繋がる。前段の結果は `ctx.inputTexture` で受け取れる。

```ts
import { BaseEffect, type BaseEffectConfig, TSL } from "dom-sync-gl";
const { vec2, vec4, fract, sin, dot } = TSL;

class GrainEffect extends BaseEffect {
  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: ({ inputTexture, uv }) => {
        const g = fract(
          sin(dot(uv.add(this.uTime), vec2(12.9898, 78.233))).mul(43758.5453),
        );
        return vec4(inputTexture.rgb.add(g.sub(0.5).mul(0.06)), inputTexture.a);
      },
      uniforms: { uTime: this.uTime },
    };
  }
  update(time: number) {
    this.setUniform("uTime", time);
  }
}

app.addEffect(new GrainEffect());
```

`plane.addEffect(effect)` で plane 単位のチェーンにもできる。
plane が可視範囲を外れた間は effect の更新・feedback 描画を停止し、復帰時は停止時間を
除いた時刻で再開する。独自のマウス履歴を持つ effect は `resume(time, mouse)` でリセットできる。
`feedback.size: 'screen'` は全画面 effect では canvas、plane effect では plane の寸法×DPR を使う。
`setupGUI(gui)` を実装しておくと、`gui` オプションに lil-gui インスタンスを渡したときだけ
コントロールが出る。

v0.3 の GLSL API（`fragmentShader` / `tDiffuse` / `IUniform`）からの移行はドキュメントの
「v0.3 からの移行」を参照。

## API reference

### `new DomSyncGL(selector, options?)`

| option | type | default | 説明 |
|---|---|---|---|
| `scrollSync` | `boolean \| ScrollSyncOptions` | `false` | スクロール同期を有効化 |
| `autoRaf` | `boolean` | `true` | 内部 rAF ループを回すか。`false` なら自前の rAF から `tick()` で駆動 |
| `pauseWhenOffscreen` | `boolean` | `false` | `scrollSync: { attach: 'dom' }` のとき、canvas が画面外にある間だけ描画ループを止める |
| `pauseRootMargin` | `string` | `'100%'` | `pauseWhenOffscreen` の判定に使う IntersectionObserver の `rootMargin` |
| `enablePointerTracking` | `boolean` | `true` | ポインタ座標と hover 判定を更新 |
| `forceWebGL` | `boolean` | `false` | WebGPU が使えても WebGL 2 バックエンドを強制（デバッグ用） |
| `maxPixelRatio` | `number` | `2` | `renderer.setPixelRatio` の上限 (モバイルは `1.5` 推奨) |
| `outputColorSpace` | `THREE.ColorSpace` | `SRGBColorSpace` | renderer の出力色空間 |
| `effectSamples` | `number` | `4` | EffectComposer の scene 描画 RT の MSAA サンプル数。`0` で無効化 |
| `stats` | `Stats \| null` | `null` | 呼び出し元が生成した stats.js インスタンス |
| `gui` | `GUI \| null` | `null` | 呼び出し元が生成した lil-gui インスタンス |

> `stats` / `gui` は**インスタンスを渡す**方式。生成・DOM への挿入・破棄はすべて呼び出し元の責務で、
> ライブラリは受け取ったものを使うだけ。以前の `showStats` / `showGUI` / `statsParent` / `guiTitle` は**廃止**。
> `enableMouseTracking` / `setMouseTrackingEnabled()` は `enablePointerTracking` 系の別名として残っている。

#### Main methods / properties

- `ready` — renderer の非同期初期化（WebGPU device 取得）の完了 Promise。await しなくても安全
- `isWebGPUBackend()` — WebGPU バックエンドで動作しているか（`ready` 解決前は常に `false`）
- `createPlane(selector, options?)` — DOM 要素にロックした plane を生成 (`selector` が `null` だと全画面背景)
- `createTextPlane(selector, options?)` — DOM のテキストを焼いた plane を生成
- `create3DObject(selector, options)` — GLTF モデルを DOM 要素にフィット
- `tick(time?)` — 1 フレーム進める (`autoRaf: false` のとき自前の rAF から呼ぶ)。内部は `update()` → `render()` の分割で、個別にも呼べる
- `addEffect(effect)` / `removeEffect(effect)` — フルスクリーンチェーンの管理
- `addObject(obj3d)` / `removeObject(obj3d)` — シーンに直接追加
- `addUpdateCallback(fn)` — 毎フレ呼ばれるコールバック登録 (unsubscribe 関数を返す)
- `addResizeCallback(fn)` — リサイズ時のコールバック登録
- `getScene()` / `getCamera()` / `getRenderer()` / `getMouse()` / `getScrollSync()` — 内部インスタンスへのアクセス
- `destroy()` — リスナー・テクスチャ・RT をすべて解放

`update()` と `render()` を個別に呼ぶ場合、`BaseEffect.update()` と feedback の更新は
renderer の初期化完了後の `render()` 内で実行される。`update()` で確定した時刻・マウス座標を
使うため、描画直前に入力が変わっても同じフレームの値でエフェクトを処理する。

### `ScrollSyncOptions`

| option | type | default | 説明 |
|---|---|---|---|
| `trackStrength` | `boolean` | `false` | `strength` (スクロール速度) の追跡を有効化 |
| `strengthDecay` | `number` | `10` | strength の指数減衰係数 |
| `overscan` | `number \| 'auto' \| false` | `'auto'` | canvas を viewport の上下に px 単位で広げる。`'auto'` は coarse pointer でのみ `vh * 0.25`、マウス環境では 0。切るなら `false` |
| `attach` | `'translate' \| 'dom'` | `'translate'` | container の貼り付け方。`'dom'` は container の CSS 配置をそのまま尊重する |

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
| `colorNode` | `(ctx: PlaneNodeContext) => Node` | テクスチャをそのまま表示 | plane の色を決める vec4 ノードを返す TSL ファクトリ |
| `positionNode` | `(ctx: PlaneNodeContext) => Node` | 既定の頂点処理 | 頂点変位用の position ノードを返すファクトリ |
| `uniforms` | `Record<string, UniformNode>` | `{}` | `uniform()` / `texture()` で生成した自前のノード |
| `updateRectEveryFrame` | `boolean` | `false` | 毎フレーム bbox を測り直す。既定はリサイズ時のみなので、GSAP / CSS animation で動く要素には必須 |
| `resizeInterval` | `number` | `100` | 自動サイズ追従中のバッファ更新・テキスト再描画の最小間隔(ms)。mesh は毎フレ追従。`0` で間引きを無効化 |
| `segments` | `number` | `1` | PlaneGeometry セグメント数 |
| `onInView` / `onOutView` | `(plane) => void` | — | IntersectionObserver コールバック |
| `inViewRootMargin` | `string` | `'100%'` | IO の rootMargin |
| `inViewRepeat` | `boolean` | `false` | `true` で出入りのたび `onInView` が発火 |
| `crossOrigin` | `string` | `'anonymous'` | `data-texture` 読み込み時の CORS 属性 |
| `textureColorSpace` | `THREE.ColorSpace` | `SRGBColorSpace` | `data-texture` で読むテクスチャの色空間 |

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
  // three/webgpu と three/tsl を再 export (利用側で別途 import 不要)
  THREE, TSL,
} from "dom-sync-gl";

import type {
  DomSyncGLOptions,
  CreatePlaneOptions,
  CreateTextPlaneOptions,
  PlaneNodeContext,
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
  EffectContext,
  EffectTarget,
  EffectLike,
  FeedbackBufferOptions,
  FeedbackInput,
  FeedbackContext,
  AddFeedbackOptions,
} from "dom-sync-gl";
```

## Browser support

- Chrome / Edge / Firefox / Safari の最新 2 バージョン
- WebGPU が使えない環境では WebGL 2 バックエンドに自動フォールバック（WebGL 2 は必須）
- IE11 などは対象外

## Bundle

`three` / `lil-gui` / `stats.js` はバンドルしていない（peer dependency。`three` は **>=0.181.0 <0.183.0**）。
`sideEffects: false` なので tree-shaking も効く。
Lenis もランタイム依存には含まない（使う場合はアプリ側で install する）。

## Develop

```bash
npm install
npm run dev        # docs/ を vitepress で起動
npm run example    # example/ を vite で起動 (http://localhost:5180)
npm run build      # dist/ にビルド
npm run test       # vitest
npm run test:gpu   # 実ブラウザ（ヘッドレス Chromium）で WebGPU / WebGL 2 の描画を検証
npm run typecheck  # ライブラリ本体 (src/)
```

## License

MIT
