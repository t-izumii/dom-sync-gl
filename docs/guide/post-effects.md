# Post Effects

`BaseEffect` を継承して fragment shader を返すだけ。`app.addEffect()` に渡すと
フルスクリーンチェーンに繋がる。エフェクトは `tDiffuse` で前段の結果を受け取れる。

## 最小エフェクト

```ts
import { BaseEffect, type BaseEffectConfig } from 'dom-sync-gl';

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
    this.setUniform('uTime', time);
  }
}

app.addEffect(new GrainEffect());
```

→ ON/OFF できる動くデモは [Demos / Post Effect](/demos/post-effect) を参照。

## plane 単位のチェーン

`plane.addEffect(effect)` で、その plane だけに適用するチェーンも作れる。
内部的には plane 用の `PlaneComposer` が立ち上がって FBO に焼かれる。

```ts
const plane = app.createPlane('.card', { fragmentShader });
plane.addEffect(new GrainEffect());
```

::: warning 1 effect = 1 plane / app
同じ `effect` インスタンスを複数のターゲットに `addEffect` すると `update()` が
同じフレームで二重に走り、内部状態が壊れることがある（DEV では警告が出る）。
複数のターゲットに掛けたい場合は別インスタンスを作る。
:::

## enable / disable

```ts
const grain = app.addEffect(new GrainEffect());
grain.enabled = false; // パススルー
```

`BaseEffect.enabled` を立てるとパスはスキップされる（リソースは残るので再 enable が軽い）。

## lil-gui 連携

`setupGUI(gui)` を実装したエフェクトは、`new DomSyncGL(..., { showGUI: true })` のときに
lil-gui パネルへ自動でフォルダが生える（**`showGUI` の既定は `false`** なので、GUI を出すには
明示的に有効化する。lil-gui は optional peer なので、使うときだけ `npm install lil-gui`）。

```ts
class GrainEffect extends BaseEffect {
  amount = 0.06;
  setupGUI(gui) {
    const f = gui.addFolder('Grain');
    f.add(this, 'amount', 0, 0.3);
    f.add(this, 'enabled');
  }
}
```

## 取り外し / 破棄

```ts
app.removeEffect(grain);   // 1 つだけ取り外す
app.clearEffects();        // 全部破棄
app.destroy();             // app ごと破棄（effect も一緒に dispose）
```

## Feedback バッファ（generator / GPGPU）

`BaseEffect` は「絵を受け取って絵を返す」**post（フィルタ / sink）**でした。これとは**出力の向きが逆**の、
**テクスチャを産み出す generator** が `FeedbackBuffer` です。ping-pong RenderTarget で前フレームの自分の
出力（`uPrev`）を読み、状態を**時間蓄積**します。マウス軌跡（trail）・流体・拡散・反応拡散などに使います。

| | post（`addEffect` / `BaseEffect`） | generator（`addFeedback` / `FeedbackBuffer`） |
|---|---|---|
| 入力 | 直前のレンダリング結果（tDiffuse） | 前フレームの自分の出力（uPrev）＋ マウス等 |
| 出力 | 描画パイプラインに書き込む（**sink**） | テクスチャを産み、別シェーダーの材料にする（**source**） |
| 状態 | 基本ステートレス（per-frame） | 永続バッファ（RT 2 枚）を時間蓄積 |
| 用途 | 色収差・グレイン・ブラー等の仕上げ | 軌跡・流体・拡散等の素材生成 |

### `plane.addFeedback()`

plane に紐づけると、毎フレ自動で `step()` され、出力テクスチャが指定 uniform に供給されます
（RT 確保 / 駆動 / resize / dispose はライブラリが担当）。

```ts
// plane 側の shader で受け取る uniform を宣言しておく
const plane = app.createPlane('.card', {
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTrailTex;   // ← addFeedback が毎フレ供給する
    void main() {
      float trail = texture2D(uTrailTex, vUv).r;
      gl_FragColor = vec4(vec3(trail), 1.0);
    }
  `,
});

const trail = plane.addFeedback({
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uPrev;   // 前フレームの自分の出力
    uniform vec2  uMouse;      // マウス UV (0..1)
    uniform float uHover;      // hover 量 (0..1)
    uniform float uAspect;     // plane の w/h
    uniform float uDecay;      // ← ユーザー uniform
    uniform float uRadius;
    void main() {
      vec3 prev = texture2D(uPrev, vUv).rgb * uDecay;          // 余韻を減衰
      vec2 d = (vUv - uMouse) * vec2(uAspect, 1.0);
      float splat = smoothstep(uRadius, 0.0, length(d)) * uHover; // 現在地にスプラット
      gl_FragColor = vec4(prev + splat, 1.0);
    }
  `,
  size: 256,
  outputUniform: 'uTrailTex',
  uniforms: { uDecay: { value: 0.94 }, uRadius: { value: 0.2 } },
});

// 実行時に調整・取り外し
trail.uniforms.uDecay.value = 0.9;
plane.removeFeedback(trail);
```

### 自動で渡る uniform（更新シェーダー）

`uPrev`(前フレーム) / `uMouse` / `uHover` / `uTime` / `uResolution`(バッファ解像度) / `uAspect`(plane の w/h)
は宣言するだけで使えます。`uniforms` で渡した値（`uDecay` 等）はマージされ、`buffer.uniforms.xxx.value`
で実行時に更新できます。

### スタンドアロン利用

`FeedbackBuffer` は plane に依存しない素の primitive としても使えます（`getRenderer()` を渡す）。

```ts
import { FeedbackBuffer } from 'dom-sync-gl';
const fb = new FeedbackBuffer(app.getRenderer(), { fragmentShader, size: 256 });
const tex = fb.step({ mouse, hover, time, aspect }); // 1 フレーム進めて最新テクスチャ取得
fb.dispose();
```
