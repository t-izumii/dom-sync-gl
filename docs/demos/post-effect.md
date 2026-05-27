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
import { WebGLApp, BaseEffect, type BaseEffectConfig } from 'dom-sync-gl';

const app = new WebGLApp('#stage', { showGUI: false });

// 1. 全画面背景 plane（selector に null を渡す）
app.createPlane(null, {
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform float uTime;
    void main() {
      vec2 uv = vUv;
      float wave = 0.5 + 0.5 * sin(uv.x * 8.0 + uTime * 0.8);
      vec3 col = mix(
        vec3(0.13, 0.18, 0.36),
        vec3(0.43, 0.95, 0.96),
        uv.y * wave
      );
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});

// 2. ポストエフェクトを 1 つ書く
class GrainEffect extends BaseEffect {
  protected getConfig(): BaseEffectConfig {
    return {
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uAmount;
        void main() {
          vec4 src = texture2D(tDiffuse, vUv);
          float g = fract(sin(dot(vUv + uTime, vec2(12.9898, 78.233))) * 43758.5453);
          gl_FragColor = vec4(src.rgb + (g - 0.5) * uAmount, src.a);
        }
      `,
      uniforms: {
        uTime: { value: 0 },
        uAmount: { value: 0.18 },
      },
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

### 1. 前段の結果は `tDiffuse` で受け取る

ポストエフェクトの fragment は、必ず `uniform sampler2D tDiffuse;` を宣言して
`texture2D(tDiffuse, vUv)` で前段の結果を取り出す。`tDiffuse` は EffectComposer
側で自動で配線される（自分で uniforms に入れる必要はない）。

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
const card = app.createPlane('#card', { fragmentShader });
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

`new WebGLApp(..., { showGUI: true })` のとき、`setupGUI()` が自動で呼ばれる。
`lil-gui` は optional peer なので、使うときだけ `npm install lil-gui`。
