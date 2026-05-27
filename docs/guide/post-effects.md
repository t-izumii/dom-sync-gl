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

`setupGUI(gui)` を実装したエフェクトは、`new WebGLApp(..., { showGUI: true })` のときに
lil-gui パネルへ自動でフォルダが生える（lil-gui は optional peer なので、使うときだけ
`npm install lil-gui`）。

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
