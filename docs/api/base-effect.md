# BaseEffect

ポストエフェクトの基底クラス。`getConfig()` で TSL の `outputNode` ファクトリと uniform を返すと、
`addEffect()` 経由でチェーンに繋がる。

## Minimal example

```ts
import { BaseEffect, type BaseEffectConfig, THREE, TSL } from 'dom-sync-gl';
const { uniform, vec4, mix } = TSL;

class TintEffect extends BaseEffect {
  private uColor = uniform(new THREE.Color('#ff66aa'));

  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: ({ inputTexture }) =>
        vec4(mix(inputTexture.rgb, this.uColor, 0.3), inputTexture.a),
      uniforms: { uColor: this.uColor },
    };
  }
}
```

前段の結果は `ctx.inputTexture`（`TextureNode`）で受け取れる。そのまま使うと `uv()` で
サンプルされ、別 UV で読む場合は `ctx.inputTexture.sample(customUv)`。スクリーン UV は
`ctx.uv` で渡ってくる。

`outputNode` は pass 追加時に**一度だけ**呼ばれ、以後の毎フレーム更新は `uniforms` に渡した
`UniformNode` の `.value` 差し替え（= `setUniform()`）で行われる。

→ v0.3 の `fragmentShader` / `tDiffuse` からの書き換えは [移行ガイド](/guide/migration-v0-4)。

## 組み込みの実行時状態

サブクラスから `protected` メンバとして参照できる。owner（`addEffect()` した `DomSyncGL` /
`DomPlane`）が毎フレーム・リサイズごとに更新するため、自前で用意する必要はない。

| メンバ | 型 | 内容 |
|---|---|---|
| `uTime` | `UniformNode<number>` | 経過秒 |
| `uMouse` | `UniformNode<Vector2>` | マウス UV。**左上原点**（`ctx.uv` と同じ座標系） |
| `width` / `height` | `number` | 直近の描画サイズ（CSS px） |

```ts
class RippleEffect extends BaseEffect {
  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: ({ inputTexture, uv }) => {
        const d = length(uv.sub(this.uMouse));
        // ...
      },
    };
  }
}
```

`uTime` / `uMouse` は `update()` が呼ばれる**直前**に更新済みなので、`update()` の中で
代入し直す必要はない。`width` / `height` も同じく `resize()` の直前に更新される。
`super.update()` / `super.resize()` の呼び忘れで壊れないよう、owner 側から必ず呼ばれる
内部 API 経由で更新している。

::: tip 解像度 uniform は用意していない
シェーダー内で解像度が必要な場合は TSL の `screenSize` を使う（毎レンダー自動更新で、
初期ダミー値も配線も不要）。ただし `screenSize` が返すのは「現在バインドされている
RenderTarget」のサイズであり、自前の小さなシミュレーショングリッドへ描画している最中は
そのグリッドサイズになる点に注意。`width` / `height` は、`new THREE.RenderTarget(w, h)` の
サイズ指定など **TSL では代替できない JS 側の実数**が必要な場面のために持っている。
:::

## Abstract / overridable

### `getConfig(): BaseEffectConfig` *(abstract)*

`outputNode` ファクトリと uniform を返す。

```ts
interface BaseEffectConfig {
  outputNode: (ctx: EffectContext) => Node;
  uniforms?: Record<string, UniformNode<unknown>>;
}
```

### `update(time, mouse?)`

毎フレーム呼ばれる。uniform の動的更新に使う。時間とマウス位置は `uTime` / `uMouse` に
反映済みなので、それ以外の状態（自前 RT の ping-pong、GUI で変わる値など）を更新する。

```ts
update() {
  this.setUniform('uStrength', this.strength);
}
```

### `resize?(width, height)`

canvas サイズ（`DomPlane` に追加した場合は plane のサイズ）が変わるたびに呼ばれる。
自前 RT を持つエフェクトはここでリサイズする。同じ値は `this.width` / `this.height` からも
読めるので、`resize()` を override せずに他のメソッドから参照してもよい。

### `setupGUI?(gui)`

`new DomSyncGL(..., { gui })` で lil-gui インスタンスを渡したときに呼ばれ、パネルへフォルダを
生やすフック。`gui` を渡していなければ呼ばれない。

```ts
setupGUI(gui) {
  const f = gui.addFolder('Tint');
  f.add(this, 'enabled');
  f.addColor(this.getUniform('uColor')!.value, 'r');
}
```

### `dispose?()`

`addEffect` を解除 / `app.destroy()` した時に呼ばれる。RT 等を持っている場合に override。

## Helpers

| メソッド | 説明 |
|---|---|
| `setUniform(key, value)` | uniform の `.value` を更新（未定義キーは DEV で警告） |
| `getUniform(key)` | `UniformNode` を取得（`.value` で読み書き） |
| `getPass()` | 内部 `EffectPass` を取得 |
| `enabled` (getter/setter) | `false` でパススルー |

## EffectComposer / EffectPass

低レベル API。自前で `EffectLike` を実装したいときに参照する。

```ts
import { EffectComposer, EffectPass, type EffectLike } from 'dom-sync-gl';
```

`DomSyncGL.setPostEffect(effectLike)` に `EffectLike` を渡せば、独自の post-effect
パイプラインを丸ごと差し込める（`addEffect()` と併用は不可）。
