# Getting Started

## Install

```bash
npm install dom-sync-gl three
```

必須は `three` だけ。GUI パネルや FPS パネルを出したいときは追加で:

```bash
npm install lil-gui stats.js
```

## 最小コード

```html
<div id="canvas" style="position: absolute; inset: 0;"></div>
<div class="hero-card">Hello</div>
```

```ts
import { WebGLApp } from 'dom-sync-gl';

const app = new WebGLApp('#canvas');

app.createPlane('.hero-card', {
  fragmentShader: `
    precision highp float;
    varying vec2 vUv;
    uniform float uTime;
    void main() {
      gl_FragColor = vec4(vUv, 0.5 + 0.5 * sin(uTime), 1.0);
    }
  `,
});
```

`.hero-card` の位置・サイズに plane が貼り付き、CSS で要素が動いてもピクセル単位で追従する。

→ 動くデモ・コード・解説は [Demos / DOM-locked Plane](/demos/plane) を参照。

## Shader で使える uniform

`createPlane()` の plane では、次の uniform を宣言するだけで使える（値の更新は内部でやる）。

| uniform | 型 | 中身 |
|---|---|---|
| `uTime` | `float` | 経過秒 |
| `uResolution` | `vec2` | plane の pixel 寸法 |
| `uMouseUV` | `vec2` | hover 中の plane-local UV (0..1) |
| `uIsHovered` | `bool` | raycast hit 中か |
| `uTexture` | `sampler2D` | `data-texture` 属性 or `setTexture()` で渡したテクスチャ |

## 全画面背景として使う

`selector` に `null` を渡すとフルスクリーン背景 plane になる。

```ts
app.createPlane(null, { fragmentShader: bgShader });
```

## 次に

- [Demos](/demos/) — 動くサンプル + コピペ可能なコード
- [Scroll Sync](/guide/scroll-sync) — スクロールと canvas を 1 frame で揃える
- [Post Effects](/guide/post-effects) — `BaseEffect` でエフェクトを書く
- [API: WebGLApp](/api/webgl-app) — 全オプション
