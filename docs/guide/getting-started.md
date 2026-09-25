# Getting Started

## Install

```bash
npm install dom-sync-gl three
```

必須は `three`（**0.181.x / 0.182.x**。内部で `three/webgpu` / `three/tsl` エントリポイントを使う）だけ。
TSL は three の版ごとに API が変わるため、CI で動作を確認した範囲だけを peerDependency に指定している。
GUI パネルや FPS パネルを出したいときは追加で:

```bash
npm install lil-gui stats.js
```

スムーズスクロールを併用したい場合は [Lenis](https://github.com/darkroomengineering/lenis) も
（ライブラリは含まない。[Scroll Sync](/guide/scroll-sync#スムーズスクロール-lenis) 参照）:

```bash
npm install lenis
```

## 最小コード

シェーダーは GLSL 文字列ではなく **TSL（Three.js Shading Language）のノードファクトリ**で書く。
ノードビルダーは `three/tsl` を直接 import してもよいし、再 export の `TSL` からも使える。

```html
<div id="canvas" style="position: absolute; inset: 0;"></div>
<div class="hero-card">Hello</div>
```

```ts
import { DomSyncGL, TSL } from 'dom-sync-gl';
const { vec4, sin } = TSL;

const app = new DomSyncGL('#canvas');

app.createPlane('.hero-card', {
  colorNode: ({ uv, uTime }) =>
    vec4(uv, sin(uTime).mul(0.5).add(0.5), 1),
});
```

`.hero-card` の位置・サイズに plane が貼り付き、ページのスクロールにはピクセル単位で追従する。

::: warning 動く要素には `updateRectEveryFrame: true` が必要
要素の位置とサイズ（`getBoundingClientRect()`）は、性能のため**既定ではリサイズ時にしか測り直さない**。
GSAP・CSS animation・transition などで要素そのものを動かすと、plane は元の位置に残る。

| 要素の動き方 | 既定で追従するか |
|---|---|
| ページのスクロール | する |
| window / container のリサイズ | する（100ms の debounce 後） |
| `position: sticky` の要素 | する（自動で毎フレーム測り直す） |
| transform / top / left のアニメーション、親要素の中でのスクロール | **しない** → `updateRectEveryFrame: true` |
| レイアウトの変化（要素の追加・削除、フォント読み込みなど） | **しない** → `updateRectEveryFrame: true` か `app.resize()` |

`updateRectEveryFrame` は plane ごとに毎フレーム layout を読むので、動く要素にだけ付ける。
:::

→ 動くデモ・コード・解説は [Demos / DOM-locked Plane](/demos/plane) を参照。
→ v0.3 の GLSL API からの書き換えは [移行ガイド](/guide/migration-v0-4) を参照。

## WebGPU と WebGL 2 フォールバック

レンダラーは `three/webgpu` の `WebGPURenderer`。**WebGPU が使える環境では WebGPU、
使えない環境では WebGL 2 バックエンドに自動フォールバック**する。TSL で書いたシェーダーは
three が WGSL / GLSL へ自動変換するため、利用側は 1 実装を書くだけでよい。

WebGPU の device 取得は非同期なので、初期化完了は `app.ready`（Promise）で待てる。

```ts
const app = new DomSyncGL('#canvas');
await app.ready; // 待たなくても安全（初期化完了まで render が no-op になるだけ）

if (app.isWebGPUBackend()) {
  console.log('WebGPU で動作中');
}
```

- `await app.ready` は**必須ではない**。`createPlane()` などは初期化前に呼んでよく、描画だけが
  初期化完了まで no-op になる。バックエンド確定後の処理（`isWebGPUBackend()` での分岐など）を
  したい場合にだけ await する
- デバッグ用に WebGL 2 バックエンドを強制する `forceWebGL: true` オプションがある
  （フォールバック時の見た目・挙動の検証用）

```ts
const app = new DomSyncGL('#canvas', { forceWebGL: true });
```

## colorNode で使えるビルトインノード

`colorNode` / `positionNode` ファクトリの引数（`PlaneNodeContext`）には、宣言不要で使える
ノードが渡ってくる（値の更新は内部でやる）。

| ノード | 型 | 中身 |
|---|---|---|
| `uTime` | `UniformNode<number>` | 経過秒 |
| `uResolution` | `UniformNode<Vector2>` | plane の pixel 寸法 |
| `uMouseUV` | `UniformNode<Vector2>` | hover 中の plane-local UV (0..1) |
| `uPrevMouse` | `UniformNode<Vector2>` | 前フレームの `uMouseUV`（同じ座標系） |
| `uMove` | `UniformNode<number>` | マウス移動強度 (0..1) |
| `uIsHovered` | `UniformNode<number>` | raycast hit 中なら 1、そうでなければ 0 |
| `uTexture` | `TextureNode` | `data-texture` 属性 or `setTexture()` で渡したテクスチャ |
| `uAlpha` | `UniformNode<number>` | 透明度（既定 1.0） |
| `uniforms` | `Record<string, UniformNode>` | `options.uniforms` で渡した自前の uniform |
| `uv` | `Node` | UV ノード |

ファクトリは plane 構築時に**一度だけ**呼ばれてノードグラフを返す。毎フレームの変化は
これらノードの `.value` 差し替えで反映される（グラフ自体は組み直されない）。

## 全画面背景として使う

`selector` に `null` を渡すとフルスクリーン背景 plane になる。

```ts
app.createPlane(null, { colorNode: bgNode });
```

## テキストを板にする

`createTextPlane()` を使うと、DOM のテキストを canvas に焼いて板として描ける。DOM 側は
`color: transparent` になるだけなので、レイアウト・アクセシビリティ・テキスト選択は残る。

```ts
app.createTextPlane('.headline');
```

## rAF を自分で持つ

既定ではライブラリが内部で rAF を回す。Lenis のようなスムーズスクロールと順序を揃えたい
場合は `autoRaf: false` にして、自前のループから `tick()` を呼ぶ。

```ts
const app = new DomSyncGL('#canvas', { autoRaf: false });

const raf = (time: number) => {
  lenis.raf(time);
  app.tick(time);
  requestAnimationFrame(raf);
};
requestAnimationFrame(raf);
```

[`pauseWhenOffscreen`](/guide/scroll-sync#オフスクリーンで描画を止める) と併用する場合、停止中は
`tick()` が no-op になるがアプリ側の rAF は回り続ける。自前の重い処理も畳みたいなら
`app.isPaused()` で分岐する。

## 次に

- [Demos](/demos/) — 動くサンプル + コピペ可能なコード
- [Scroll Sync](/guide/scroll-sync) — スクロールと canvas を 1 frame で揃える
- [Text Planes](/guide/text-planes) — テキストレイヤーを WebGL 管理下に置く
- [Post Effects](/guide/post-effects) — `BaseEffect` でエフェクトを書く
- [v0.3 からの移行](/guide/migration-v0-4) — GLSL → TSL の対応表と書き換え例
- [API: DomSyncGL](/api/dom-sync-gl) — 全オプション
