# BaseEffect

ポストエフェクトの基底クラス。`getConfig()` で fragment shader と uniform を返すと、
`addEffect()` 経由でチェーンに繋がる。

## Minimal example

```ts
import { BaseEffect, type BaseEffectConfig } from 'dom-sync-gl';

class TintEffect extends BaseEffect {
  protected getConfig(): BaseEffectConfig {
    return {
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform vec3 uColor;
        void main() {
          vec4 src = texture2D(tDiffuse, vUv);
          gl_FragColor = vec4(mix(src.rgb, uColor, 0.3), src.a);
        }
      `,
      uniforms: {
        uColor: { value: new THREE.Color('#ff66aa') },
      },
    };
  }
}
```

前段の結果は `tDiffuse` で受け取れる。

## Abstract / overridable

### `getConfig(): BaseEffectConfig` *(abstract)*

fragment shader と uniform を返す。

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

`showGUI: true` のとき lil-gui へフォルダを生やすフック。

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
| `setUniform(key, value)` | uniform を更新（未定義キーは DEV で警告） |
| `getUniform(key)` | `THREE.IUniform` を取得 |
| `getPass()` | 内部 `EffectPass` を取得 |
| `enabled` (getter/setter) | `false` でパススルー |

## EffectComposer / EffectPass

低レベル API。自前で `EffectLike` を実装したいときに参照する。

```ts
import { EffectComposer, EffectPass, type EffectLike } from 'dom-sync-gl';
```

`WebGLApp.setPostEffect(effectLike)` に `EffectLike` を渡せば、独自の post-effect
パイプラインを丸ごと差し込める（`addEffect()` と併用は不可）。
