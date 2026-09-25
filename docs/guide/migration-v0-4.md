# v0.3 (GLSL) からの移行ガイド

v0.4 でレンダラーを `three/webgpu` の `WebGPURenderer` に載せ替え、シェーダー契約を
GLSL 文字列から **TSL（Three.js Shading Language）のノードファクトリ**に全面変更した。
旧 GLSL API（`fragmentShader` / `vertexShader` / `IUniform` 形式の `uniforms`）は残っていない。

TSL で書いたシェーダーは three が WGSL（WebGPU）/ GLSL（WebGL 2）へ自動変換するため、
**1 実装で両バックエンドに対応**する。WebGPU 非対応環境では WebGL 2 に自動フォールバックするので、
利用側でバックエンドを意識する必要はない。

## 破壊的変更の一覧

| 変更点 | v0.3 | v0.4 |
|---|---|---|
| plane のシェーダー | `fragmentShader` / `vertexShader`（GLSL 文字列） | `colorNode` / `positionNode`（TSL ノードファクトリ） |
| エフェクトのシェーダー | `BaseEffectConfig.fragmentShader` | `BaseEffectConfig.outputNode` |
| feedback のシェーダー | `FeedbackBufferOptions.fragmentShader` | `FeedbackBufferOptions.outputNode` |
| uniform の形式 | `{ uX: { value: 0 } }`（`IUniform`） | `{ uX: uniform(0) }`（TSL の `UniformNode`） |
| 前段パスの参照 | `uniform sampler2D tDiffuse` を宣言 | `ctx.inputTexture` を使う |
| `addFeedback()` | `outputUniform` 名の uniform が自動で生える | `outputUniform` と同名の `texture()` ノードを `options.uniforms` に**事前宣言**する |
| `uIsHovered` | `bool` | `float`（0 / 1） |
| 初期化 | 同期 | 非同期（`await app.ready`。待たなくても安全） |
| `textureColorSpace` 既定 | `NoColorSpace` | `SRGBColorSpace` |
| renderer | `THREE.WebGLRenderer` | `THREE.WebGPURenderer`（`three/webgpu`） |
| three の peerDependency | `>=0.150.0` | `>=0.181.0 <0.183.0` |

## GLSL → TSL 対応表

| GLSL (v0.3) | TSL (v0.4) |
|---|---|
| `varying vec2 vUv` | `ctx.uv`（宣言不要で ctx から受け取る） |
| `uniform float uTime;` + `uniforms: { uTime: { value: 0 } }` | `const uTime = uniform(0)` を作って `uniforms: { uTime }` |
| `texture2D(uTexture, vUv)` | `ctx.uTexture`（そのままで `uv()` サンプル）。別 UV で読むなら `ctx.uTexture.sample(customUv)` |
| `texture2D(tDiffuse, vUv)` | `ctx.inputTexture` |
| `gl_FragColor = vec4(...);` | `return vec4(...)` |
| `a * b + c` | `a.mul(b).add(c)` |
| `sin` / `mix` / `smoothstep` / `fract` / `dot` / `distance` … | 同名の関数を `three/tsl`（または再 export の `TSL`）から import |
| `cond ? a : b` | `select(cond, a, b)` |
| `material.uniforms.uX.value = v` | 保持している `UniformNode` の `.value = v`（effect は従来どおり `setUniform()`） |

TSL のノードビルダーは `three/tsl` を直接 import してもよいし、本ライブラリが再 export する
`TSL` 名前空間からも使える。

```ts
import { TSL } from 'dom-sync-gl';
const { uniform, texture, uv, vec2, vec3, vec4, sin, mix } = TSL;
```

## 書き換え例 1: createPlane のシェーダー

::: code-group

```ts [v0.3 (GLSL)]
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

```ts [v0.4 (TSL)]
import { TSL } from 'dom-sync-gl';
const { vec4, sin } = TSL;

app.createPlane('.hero-card', {
  colorNode: ({ uv, uTime }) =>
    vec4(uv, sin(uTime).mul(0.5).add(0.5), 1),
});
```

:::

`colorNode` は **plane 構築時に一度だけ呼ばれ**、TSL のノードグラフを返す。以後の毎フレーム更新は
`ctx` に渡ってくるノード（`uTime` 等）の `.value` をライブラリが差し替えることで行われる。
ファクトリ内に per-frame の JS 処理を書く場所ではない点に注意（グラフは 1 回組んだら固定）。

## 書き換え例 2: BaseEffect

::: code-group

```ts [v0.3 (GLSL)]
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
          float g = fract(sin(dot(vUv + uTime,
            vec2(12.9898, 78.233))) * 43758.5453);
          gl_FragColor = vec4(src.rgb + (g - 0.5) * 0.06, src.a);
        }
      `,
      uniforms: { uTime: { value: 0 } },
    };
  }
  update(time: number) {
    this.setUniform('uTime', time);
  }
}
```

```ts [v0.4 (TSL)]
import { TSL } from 'dom-sync-gl';
const { uniform, vec2, vec4, fract, sin, dot } = TSL;

class GrainEffect extends BaseEffect {
  private uTime = uniform(0);

  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: ({ inputTexture, uv }) => {
        const g = fract(
          sin(dot(uv.add(this.uTime), vec2(12.9898, 78.233)))
            .mul(43758.5453),
        );
        return vec4(
          inputTexture.rgb.add(g.sub(0.5).mul(0.06)),
          inputTexture.a,
        );
      },
      uniforms: { uTime: this.uTime },
    };
  }
  update(time: number) {
    this.setUniform('uTime', time);
  }
}
```

:::

`tDiffuse` の自動配線は廃止され、前段パスの結果は `ctx.inputTexture`（`TextureNode`）として
受け取る。`setUniform()` / `getUniform()` の使用感は変わらない（`getUniform()` の返り値は
`IUniform` から `UniformNode` になったが、どちらも `.value` を持つ）。

## 書き換え例 3: addFeedback

v0.4 では colorNode のノードグラフが**構築時に確定する**ため、`addFeedback()` が後から uniform を
生やすことができない。出力先の `texture()` ノードを `createPlane` の `options.uniforms` に
**同名で事前宣言**しておく。

::: code-group

```ts [v0.3 (GLSL)]
const plane = app.createPlane('.card', {
  fragmentShader: `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTrailTex; // addFeedback が自動で生やす
    void main() {
      gl_FragColor = vec4(vec3(texture2D(uTrailTex, vUv).r), 1.0);
    }
  `,
});

const trail = plane.addFeedback({
  fragmentShader: trailFragment,
  size: 256,
  outputUniform: 'uTrailTex',
  uniforms: { uDecay: { value: 0.94 } },
});
```

```ts [v0.4 (TSL)]
import { TSL } from 'dom-sync-gl';
const { texture, uniform, vec2, vec3, vec4, smoothstep, length } = TSL;

// 出力先ノードを事前に作る（addFeedback が毎フレーム .value を差し替える）
const uTrailTex = texture();

const plane = app.createPlane('.card', {
  uniforms: { uTrailTex }, // outputUniform と同名で渡す
  colorNode: () => vec4(vec3(uTrailTex.r), 1),
});

const uDecay = uniform(0.94);
const trail = plane.addFeedback({
  size: 256,
  outputUniform: 'uTrailTex',
  uniforms: { uDecay },
  outputNode: ({ uPrev, uMouse, uHover, uAspect, uv }) => {
    const prev = uPrev.rgb.mul(uDecay);
    const d = uv.sub(uMouse).mul(vec2(uAspect, 1));
    const splat = smoothstep(0.2, 0.0, length(d)).mul(uHover);
    return vec4(prev.add(splat), 1);
  },
});
```

:::

## 挙動の変更

### 初期化が非同期になった（`ready`）

WebGPU の device 取得は async のため、renderer の初期化完了を示す `ready: Promise<void>` が生えた。
**await しなくても安全**（初期化完了まで `render()` が no-op になるだけ）だが、バックエンド確定後の
処理をしたい場合は await する。

```ts
const app = new DomSyncGL('#canvas');
await app.ready;
console.log(app.isWebGPUBackend()); // WebGL 2 フォールバック時は false
```

デバッグ用に WebGL 2 バックエンドを強制する `forceWebGL: true` オプションも追加された。

### `textureColorSpace` の既定が `SRGBColorSpace` になった

v0.3 の既定は `NoColorSpace`（生の値を素通し）だったが、v0.4 の `NodeMaterial` は画面出力時に
linear → sRGB 変換を自動で行う。入力を `SRGBColorSpace`（サンプル時に linear へデコード）に
することで decode → encode が相殺し、DOM の画像と表示が一致する。**データテクスチャ等で生の値を
そのまま扱いたい場合のみ** `textureColorSpace: THREE.NoColorSpace` を明示する。

```ts
app.createPlane('.card', {
  textureColorSpace: THREE.NoColorSpace, // 旧挙動が必要な場合
});
```

### three の peerDependency が `>=0.181.0 <0.183.0` になった

`three/webgpu` / `three/tsl` エントリポイントと、内部で使う `QuadMesh` / `RenderTarget` などの
API を前提にしている。0.180 以前は符号付き feedback の値が正しく保持されず、0.183 以降は
TSL の型定義が大きく変わるため、CI で実描画まで確認した 0.181.x / 0.182.x に限定している。
合わせて型も `THREE.WebGLRenderer` → `THREE.WebGPURenderer`、`WebGLRenderTarget` → `RenderTarget` に
変わっている（`render({ outputTarget })` に渡す型も同様）。
