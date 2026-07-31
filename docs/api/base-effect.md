# BaseEffect

ポストエフェクトの基底クラス。`getConfig()` で TSL の `outputNode` ファクトリと uniform を返すと、
`addEffect()` 経由でチェーンに繋がる。

## Minimal example

```ts
import { BaseEffect, type BaseEffectConfig, THREE, TSL } from "dom-sync-gl";
const { uniform, vec4, mix } = TSL;

class TintEffect extends BaseEffect {
  private uColor = uniform(new THREE.Color("#ff66aa"));

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

| メンバ             | 型                     | 内容                                                                    |
| ------------------ | ---------------------- | ----------------------------------------------------------------------- |
| `uTime`            | `UniformNode<number>`  | 経過秒                                                                  |
| `uMouse`           | `UniformNode<Vector2>` | マウス UV。**左上原点**（`ctx.uv` と同じ座標系）                        |
| `uPrevMouse`       | `UniformNode<Vector2>` | 前フレームのマウス UV。座標系は `uMouse` と同じ。初回は `uMouse` と同値 |
| `uMove`            | `UniformNode<number>`  | マウス移動強度。0〜1 に正規化され、静止すると緩やかに 0 へ落ちる        |
| `mouseMotion`      | `MouseMotion`          | `uPrevMouse` / `uMove` の算出元。調整ノブと前フレーム位置を持つ         |
| `width` / `height` | `number`               | 直近の描画サイズ（CSS px）                                              |

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

`uTime` / `uMouse` / `uPrevMouse` / `uMove` は `update()` が呼ばれる**直前**に更新済みなので、`update()` の中で
代入し直す必要はない。`width` / `height` も同じく `resize()` の直前に更新される。
`super.update()` / `super.resize()` の呼び忘れで壊れないよう、owner 側から必ず呼ばれる
内部 API 経由で更新している。

### `uMove`（マウス移動強度ゲート）

前フレームからのマウス移動量を 0〜1 に正規化した値。ブラシやトレイルの強度に掛けて、
「動かしている間だけ描く」を作るためのもの。

```ts
outputNode: ({ inputTexture }) => {
  const glow = smoothstep(0.05, 0.0, length(uv().sub(this.uMouse)));
  return vec4(inputTexture.rgb.add(glow.mul(this.uMove)), inputTexture.a);
};
```

立ち上がりは**即座**、減衰は**緩やか**という非対称な挙動になっている。動き出した瞬間に
反応しないと入力が遅れて感じられる一方、止めた瞬間に消えると残像が途切れて見えるため。

| `mouseMotion` のノブ | 既定     | 内容                                                                |
| -------------------- | -------- | ------------------------------------------------------------------- |
| `threshold`          | `0.0008` | この移動距離以下は 0 として扱う（手ぶれ・サブピクセルの揺れの除去） |
| `scale`              | `0.01`   | この移動距離で 1 に到達する。これを超えても 1 で頭打ち              |
| `release`            | `0.85`   | 静止時に毎フレーム掛かる減衰率                                      |

::: tip plane 側の `FeedbackContext.uMove` と同じもの
`plane.addFeedback()` の `uMove` / `uPrevMouse`、`createPlane()` の
`PlaneNodeContext.uMove` / `uPrevMouse` と同じ `MouseMotion` を使っているので、3 経路で
同じ手触りが得られる。ノブの調整幅も同じ感覚で使える。
:::

### `uPrevMouse`（前フレームのマウス位置）

移動量ベクトル・移動距離・進行方向といった派生形は、`uMouse` との差分から導出する。
初回フレームは `uMouse` と同値になるので、「前回値がまだ無い」フラグを自前で持つ必要はない
（差分が自然に 0 になる）。JS 側からは `this.mouseMotion.prev` で同じ値を読める。

```ts
outputNode: ({ inputTexture }) => {
  const delta = this.uMouse.sub(this.uPrevMouse); // 今フレームの移動ベクトル
  // ...
};
```

::: tip 解像度 uniform は用意していない
シェーダー内で解像度が必要な場合は TSL の `screenSize` を使う（毎レンダー自動更新で、
初期ダミー値も配線も不要）。ただし `screenSize` が返すのは「現在バインドされている
RenderTarget」のサイズであり、自前の小さなシミュレーショングリッドへ描画している最中は
そのグリッドサイズになる点に注意。`width` / `height` は、`new THREE.RenderTarget(w, h)` の
サイズ指定など **TSL では代替できない JS 側の実数**が必要な場面のために持っている。
:::

## フィードバックバッファ

残像・トレイル・シミュレーション系のエフェクト向けに、**effect が所有する蓄積バッファ**を
`getConfig()` の `feedback` で宣言できる。RenderTarget の ping-pong ペア・初回クリア・
毎フレームの描画と swap・リサイズ・破棄はすべて `BaseEffect` が持つので、サブクラスは
「蓄積の計算式（TSL ノード）」だけを書けばよい。

```ts
class TrailEffect extends BaseEffect {
  protected getConfig(): BaseEffectConfig {
    return {
      feedback: {
        // prev = 前フレームの蓄積値。ここに今フレーム分を足し込んで返す
        node: ({ prev, uv }) => {
          const d = length(uv.sub(this.uMouse));
          const brush = smoothstep(0.05, 0.0, d);
          return vec4(prev.rgb.mul(0.95).add(brush), 1.0);
        },
      },
      // 蓄積結果は画面外の RT にあるので、inputTexture と合成して初めて画面に出る
      outputNode: ({ inputTexture }) =>
        vec4(inputTexture.rgb.add(this.feedbackTexture.rgb), inputTexture.a),
    };
  }
}
```

| メンバ / オプション | 内容                                                                      |
| ------------------- | ------------------------------------------------------------------------- |
| `feedbackTexture`   | 蓄積バッファの**最新結果**を読む `TextureNode`。`outputNode` から参照する |
| `feedback.node`     | 新しい蓄積値（vec4）を返すファクトリ。register 時に**一度だけ**呼ばれる   |
| `feedback.size`     | `'screen'`（既定 / drawing buffer と同解像度）または数値 N（N×N の正方）  |
| `feedback.type`     | 既定 `THREE.HalfFloatType`                                                |
| `feedback.filter`   | 既定 `THREE.LinearFilter`                                                 |

::: warning `outputNode` で合成しないと画面には出ない
蓄積バッファは画面外の RenderTarget であり、post effect チェーンには自動では入らない。
`outputNode` の中で `feedbackTexture` を `inputTexture` と合成する（足す・mix する・
UV をずらす等）まで、描いた内容は一切表示されない。
:::

::: warning `feedback.node` からは `inputTexture` を参照できない
蓄積バッファを描くタイミングは composer の `render()` **より前**（`update()` の直後）。
その時点の `inputTexture` が指しているのは前フレームの、しかもこれから上書きされる
ping-pong ターゲットなので、読んでも意味のある値にならない。前段の描画結果を混ぜたい
場合は `feedback.node` ではなく `outputNode` 側で行う。
:::

`feedback.node` に渡される `uv` は蓄積バッファの UV で、`ctx.uv` / `uMouse` と同じ
**左上原点**。そのまま `uMouse` と比較してよい。

`feedback.node` は `update()` の**直後**に評価される。`update()` の中で更新した
uniform（GUI 由来の値など）はその場で蓄積の計算に反映される。

::: tip 既定が HalfFloat な理由
8bit（`UnsignedByteType`）だと「前フレーム × 0.95」の繰り返しで丸め戻りが起きる。
値 10/255 に 0.95 を掛けると 9.5/255 で、四捨五入すると 10/255 に戻ってしまい、
残像がいつまでも消えない“幽霊”が残る。減衰を繰り返す用途では HalfFloat 以上にする。
:::

::: tip `size: 'screen'` はリサイズで内容が失われる
canvas サイズが変わると RenderTarget を作り直すため、それまでの蓄積内容は破棄されて
0 クリアからやり直しになる。リサイズをまたいで内容を保ちたい場合は
`size` に数値を指定して固定解像度にする（この場合はリサイズで作り直さない）。
:::

## Abstract / overridable

### `getConfig(): BaseEffectConfig` _(abstract)_

`outputNode` ファクトリと uniform を返す。

```ts
interface BaseEffectConfig {
  outputNode: (ctx: EffectContext) => Node;
  uniforms?: Record<string, UniformNode<unknown>>;
  /** 蓄積バッファを宣言する（→ [フィードバックバッファ](#フィードバックバッファ)） */
  feedback?: FeedbackOptions;
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

| メソッド                  | 説明                                                  |
| ------------------------- | ----------------------------------------------------- |
| `setUniform(key, value)`  | uniform の `.value` を更新（未定義キーは DEV で警告） |
| `getUniform(key)`         | `UniformNode` を取得（`.value` で読み書き）           |
| `getPass()`               | 内部 `EffectPass` を取得                              |
| `enabled` (getter/setter) | `false` でパススルー                                  |

## EffectComposer / EffectPass

低レベル API。自前で `EffectLike` を実装したいときに参照する。

```ts
import { EffectComposer, EffectPass, type EffectLike } from "dom-sync-gl";
```

`DomSyncGL.setPostEffect(effectLike)` に `EffectLike` を渡せば、独自の post-effect
パイプラインを丸ごと差し込める（`addEffect()` と併用は不可）。
