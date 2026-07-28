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

毎フレーム呼ばれる。uniform の動的更新に使う。

```ts
update(time: number) {
  this.setUniform('uTime', time);
}
```

### `resize?(width, height)`

canvas サイズが変わるたびに呼ばれる。自前 RT を持つエフェクトはここでリサイズする。

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
