# Post Effects

`BaseEffect` を継承して TSL の `outputNode` ファクトリを返すだけ。`app.addEffect()` に渡すと
フルスクリーンチェーンに繋がる。前段の結果は `ctx.inputTexture` で受け取れる。

## 最小エフェクト

```ts
import { BaseEffect, type BaseEffectConfig, TSL } from 'dom-sync-gl';
const { uniform, vec2, vec4, fract, sin, dot } = TSL;

class GrainEffect extends BaseEffect {
  private uTime = uniform(0);

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
    this.setUniform('uTime', time);
  }
}

app.addEffect(new GrainEffect());
```

`outputNode` は pass 追加時に**一度だけ**呼ばれてノードグラフを返す。以後の毎フレーム更新は
`uniforms` に渡した `UniformNode` の `.value` 差し替え（= `setUniform()`）で行われる。
`ctx.inputTexture` は前段パスの出力を読む `TextureNode` で、そのまま使うと `uv()` で
サンプルされる（別 UV で読む場合は `ctx.inputTexture.sample(customUv)`）。

→ ON/OFF できる動くデモは [Demos / Post Effect](/demos/post-effect) を参照。
→ v0.3 の GLSL（`fragmentShader` / `tDiffuse`）からの書き換えは [移行ガイド](/guide/migration-v0-4)。

## plane 単位のチェーン

`plane.addEffect(effect)` で、その plane だけに適用するチェーンも作れる。
内部的には plane 用の `PlaneComposer` が立ち上がって FBO に焼かれる。

```ts
const plane = app.createPlane('.card', { colorNode });
plane.addEffect(new GrainEffect());
```

::: warning 1 effect = 1 plane / app
同じ `effect` インスタンスを複数のターゲットに `addEffect` すると `update()` が
同じフレームで二重に走り、内部状態が壊れることがある（二重登録は throw する）。
複数のターゲットに掛けたい場合は別インスタンスを作る。
:::

## enable / disable

```ts
const grain = app.addEffect(new GrainEffect());
grain.enabled = false; // パススルー
```

`BaseEffect.enabled` を立てるとパスはスキップされる（リソースは残るので再 enable が軽い）。

## lil-gui 連携

`setupGUI(gui)` を実装したエフェクトは、`gui` オプションに lil-gui インスタンスを**渡したとき**に
限り、パネルへ自動でフォルダが生える。lil-gui の生成・破棄は呼び出し元の責務で、ライブラリは
受け取ったインスタンスを使うだけ（optional peer なので、使うときだけ `npm install lil-gui`）。

```ts
import GUI from 'lil-gui';

const app = new DomSyncGL('#canvas', {
  gui: new GUI({ title: 'Effects' }),
});
```

`gui` を渡さなければ `setupGUI()` は呼ばれない。以前の `showGUI` / `guiTitle` は廃止された。

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

## Feedback バッファ（generator）

`BaseEffect` は「絵を受け取って絵を返す」**post（フィルタ / sink）**でした。これとは**出力の向きが逆**の、
**テクスチャを産み出す generator** が `FeedbackBuffer` です。ping-pong RenderTarget で前フレームの自分の
出力（`uPrev`）を読み、状態を**時間蓄積**します。マウス軌跡（trail）・流体・拡散・反応拡散などに使います。

::: tip compute は使わない
実装は **RenderTarget 2 枚の ping-pong（render-to-texture）のみ**。WebGPU の compute シェーダー
（GPGPU）は使わないので、WebGL 2 フォールバック環境でもそのまま同じ挙動で動きます。蓄積は
8bit RGBA 上で行います（長時間の減衰でバンディングが気になる用途では将来オプションで高精度 RT を検討）。
:::

| | post（`addEffect` / `BaseEffect`） | generator（`addFeedback` / `FeedbackBuffer`） |
|---|---|---|
| 入力 | 直前のレンダリング結果（`ctx.inputTexture`） | 前フレームの自分の出力（`uPrev`）＋ マウス等 |
| 出力 | 描画パイプラインに書き込む（**sink**） | テクスチャを産み、別シェーダーの材料にする（**source**） |
| 状態 | 基本ステートレス（per-frame） | 永続バッファ（RT 2 枚）を時間蓄積 |
| 用途 | 色収差・グレイン・ブラー等の仕上げ | 軌跡・流体・拡散等の素材生成 |

### `plane.addFeedback()`

plane に紐づけると、毎フレ自動で `step()` され、出力テクスチャが指定した `texture()` ノードに
供給されます（RT 確保 / 駆動 / resize / dispose はライブラリが担当）。

colorNode のノードグラフは**構築時に確定する**ため、後から uniform を注入できません。
出力先の `texture()` ノードを `createPlane` の `options.uniforms` に **`outputUniform` と同名で
事前宣言**しておきます。

```ts
import { TSL } from 'dom-sync-gl';
const { texture, uniform, vec2, vec3, vec4, smoothstep, length } = TSL;

// 1. 出力先ノードを事前に作る（addFeedback が毎フレーム .value を差し替える）
const uTrailTex = texture();

// 2. plane の colorNode から参照する
const plane = app.createPlane('.card', {
  uniforms: { uTrailTex }, // outputUniform と同名で渡す
  colorNode: () => vec4(vec3(uTrailTex.r), 1),
});

// 3. feedback 本体。outputNode が前フレームの自分（uPrev）を読んで蓄積する
const uDecay = uniform(0.94);
const uRadius = uniform(0.2);

const trail = plane.addFeedback({
  size: 256,
  outputUniform: 'uTrailTex',
  uniforms: { uDecay, uRadius },
  outputNode: ({ uPrev, uMouse, uHover, uAspect, uv }) => {
    const prev = uPrev.rgb.mul(uDecay);                        // 余韻を減衰
    const d = uv.sub(uMouse).mul(vec2(uAspect, 1));
    const splat = smoothstep(uRadius, 0.0, length(d)).mul(uHover); // 現在地にスプラット
    return vec4(prev.add(splat), 1);
  },
});

// 実行時に調整・取り外し
uDecay.value = 0.9;            // 変数で持っているならそのまま
trail.uniforms.uDecay.value = 0.9; // buffer 経由でも同じノードに触れる
plane.removeFeedback(trail);
```

### 自動で渡るノード（outputNode の ctx）

`uPrev`（前フレームの出力 / `TextureNode`）/ `uMouse` / `uPrevMouse` / `uHover` / `uTime` /
`uResolution`（バッファ解像度）/ `uAspect`（plane の w/h）/ `uMove`（マウス移動量）/ `uv` は
ctx から受け取るだけで使えます。`uniforms` で渡した `UniformNode`（`uDecay` 等）は
`ctx.uniforms` にもマージされ、`buffer.uniforms.xxx.value` で実行時に更新できます。

### スタンドアロン利用

`FeedbackBuffer` は plane に依存しない素の primitive としても使えます（`getRenderer()` を渡す）。

```ts
import { FeedbackBuffer } from 'dom-sync-gl';
const fb = new FeedbackBuffer(app.getRenderer(), { outputNode, size: 256 });
const tex = fb.step({ mouse, hover, time, aspect }); // 1 フレーム進めて最新テクスチャ取得
fb.dispose();
```
