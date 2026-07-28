# Post Effect

全画面背景 plane に Grain ポストエフェクトを掛けて、ON/OFF できる例。

## Demo

<DemoEffect />

## HTML

ポストエフェクトだけなら、plane を貼り付ける DOM 要素は要らない。
WebGL を載せるコンテナ 1 つだけ。

```html
<div id="stage" style="position: relative; height: 280px; overflow: hidden;"></div>
```

## TypeScript

```ts
import { DomSyncGL, BaseEffect, type BaseEffectConfig, TSL } from 'dom-sync-gl';
const { uniform, vec2, vec3, vec4, sin, mix, fract, dot } = TSL;

const app = new DomSyncGL('#stage');

// 1. 全画面背景 plane（selector に null を渡す）
app.createPlane(null, {
  colorNode: ({ uv, uTime }) => {
    const wave = sin(uv.x.mul(8).add(uTime.mul(0.8))).mul(0.5).add(0.5);
    const col = mix(
      vec3(0.13, 0.18, 0.36),
      vec3(0.43, 0.95, 0.96),
      uv.y.mul(wave),
    );
    return vec4(col, 1);
  },
});

// 2. ポストエフェクトを 1 つ書く
class GrainEffect extends BaseEffect {
  private uTime = uniform(0);
  private uAmount = uniform(0.18);

  protected getConfig(): BaseEffectConfig {
    return {
      outputNode: ({ inputTexture, uv }) => {
        const g = fract(
          sin(dot(uv.add(this.uTime), vec2(12.9898, 78.233))).mul(43758.5453),
        );
        return vec4(
          inputTexture.rgb.add(g.sub(0.5).mul(this.uAmount)),
          inputTexture.a,
        );
      },
      uniforms: { uTime: this.uTime, uAmount: this.uAmount },
    };
  }
  update(time: number) {
    this.setUniform('uTime', time);
  }
}

// 3. チェーンに繋ぐ
const grain = app.addEffect(new GrainEffect());

// 4. ON/OFF
button.addEventListener('click', () => {
  grain.enabled = !grain.enabled;
});
```

## ポイント

### 1. 前段の結果は `ctx.inputTexture` で受け取る

ポストエフェクトの `outputNode` は、ctx で渡ってくる `inputTexture`（`TextureNode`）から
前段の結果を取り出す。配線は EffectComposer 側で自動で行われる（v0.3 の `tDiffuse` 宣言は不要に
なった）。そのまま使うと `uv()` でサンプルされ、歪ませたい場合は
`inputTexture.sample(customUv)` で別 UV から読める。

### 2. チェーンの順番 = `addEffect` した順

```ts
app.addEffect(new BlurEffect());
app.addEffect(new GrainEffect()); // Blur のあとに Grain が掛かる
```

ping-pong RT で順に適用される。エフェクト数が増えても RT は 2 枚しか使わない。

### 3. `enabled = false` はパススルー

`BaseEffect.enabled = false` でそのパスはスキップされ、入力がそのまま次に渡る。
リソースは残るので再 ON が軽い。完全に破棄したい場合は `app.removeEffect(grain)`。

### 4. plane 単位のチェーンも書ける

`plane.addEffect(effect)` で、その plane だけに掛かるチェーンを別建てできる。
全画面エフェクトと別系統で動く。

```ts
const card = app.createPlane('#card', { colorNode });
card.addEffect(new GrainEffect());
```

::: warning 同じインスタンスは使い回さない
同じ `effect` インスタンスを `app.addEffect()` と `plane.addEffect()` の両方に
渡すと `update()` が同フレームで二重に走り、内部状態が壊れる。複数のターゲット
に掛けたい場合は別インスタンスを new する。
:::

### 5. lil-gui で動的に調整したい場合

```ts
class GrainEffect extends BaseEffect {
  amount = 0.18;
  setupGUI(gui) {
    const f = gui.addFolder('Grain');
    f.add(this, 'amount', 0, 0.5).onChange((v) => this.setUniform('uAmount', v));
    f.add(this, 'enabled');
  }
}
```

`new DomSyncGL(..., { gui: new GUI() })` のように lil-gui インスタンスを渡したとき、
`setupGUI()` が自動で呼ばれる。`lil-gui` は optional peer なので、使うときだけ
`npm install lil-gui`。
