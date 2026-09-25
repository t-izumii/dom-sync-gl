# HALATION — 光の残響展 / domSyncGL sample

`dom-sync-gl` のメインサンプル。架空の展覧会「HALATION — 光の残響展」のサイトを、
ほぼ黒の地にハレーションの橙〜淡金とシアンの対旋律だけで組んでいる。
画像・動画アセットは持たず、見えている光はすべて TSL シェーダー・Canvas 2D の図版・
DOM から焼いた文字でできている（展覧会・会場・人物はすべて架空）。

## 章と使っている機能

| 章 | 内容 | 主なライブラリ機能 |
|---|---|---|
| ローダー / イントロ | 百分率カウンタ、黒地に育つ光漏れ、ノイズ境界で溶けて本編へ移るハレーションのバースト | `addEffect(new FinishEffect())`（`BaseEffect` 継承）の uniform を `setUniform` で駆動 |
| 00 Prologue | 全画面の「光の場」（ドメインワープした fbm の霧・アナモルフィックのストリーク・芯の外側の赤い滲み）。見出し HALATION はポインタで屈折し RGB が分かれる | `createPlane(null, …)` / `createTextPlane` + 独自 `colorNode`（`uTexture` `uMouseUV`）/ `isHovered()` |
| 01 Manifesto | 読み進めた語から点灯する本文（DOM、CSS 変数で制御）と、その位置に灯る横一文字のフレア | DOM ロックした `createPlane` + 加算合成（`material.blending`） |
| 02 Exhibits | 縦スクロールを横移動に変換する固定ギャラリー。5 作品（Caustic / Aurora / Moiré / Ink / Prism）それぞれの作品シェーダー、斜めのワイプで出現、ホバーでレンズ、スクロール速度で板がしなる | `updateRectEveryFrame` / `positionNode` + `segments` / `onInView`（`inViewRootMargin: '0px'`）/ `uMouseUV` |
| 03 Process | 制作段階（Sketch → Light test → Final）を液体ガラス越しに切り替え。図版は Canvas 2D で生成 | effectsLib の `LiquidSwap`（`planeOptions()`）|
| 04 Figures | 数字を GL に焼き、光の帯を通す | `createTextPlane` + `refreshStyleOnResize` |
| 05 Visit | 巨大な「Linger.」をポインタでかき混ぜる | `createTextPlane` + 板単位の `plane.addEffect(new MouseFlowEffect())`（effectsLib）|
| 全体 | Lenis と 1 本の rAF、章ごとに移る光の色、スクロール速度で強まる色収差、グレイン・走査線・ビネット、章表示付きのナビ、カスタムカーソル | `autoRaf: false` + `tick()` / `scrollSync: { trackStrength: true }` の `strength` / `isPointerActive()` `getMouse()` |

### 1 本のループ

`main.ts` の rAF が毎フレーム

1. `lenis.raf(time)` でスクロールを確定し、
2. DOM を書く（ギャラリーの横送り・語の点灯・章表示・カーソル）と同時に、共有 uniform
   （`site/uniforms.ts`: 時計・符号付き速度・章の色など）を更新し、
3. `app.tick(time)` で板の位置を読み直して描画する。

ギャラリーの track の `transform` は `tick()` より前に書くので、`updateRectEveryFrame` の
板は同じフレームの位置を読む。Lenis / DomSyncGL / カーソルのどれも独自の rAF を持たない。

### 端末・設定による分岐

- `prefers-reduced-motion: reduce`: スムーズスクロールを切り、ギャラリーを固定せず縦に並べ、
  シェーダーの時計を止めて静止した一枚にする（途中の切り替えにも追従）。イントロは短いフェードだけ。
- タッチ（`pointer: coarse`）: カスタムカーソルなし、fbm のオクターブ数と板の分割数を下げ、DPR 上限 1.5。
- 幅 900px 以下: ギャラリーを縦並びに、ナビは章表示だけに。375px 幅まで横はみ出しなし。
- GL を初期化できない環境: `html.no-gl` で DOM と CSS のグラデーションだけで読める構成に倒す
  （文字の板を作らないので DOM の文字がそのまま見える）。
- `?debug` で stats.js / lil-gui、`?backend=webgl` で WebGL 2 フォールバックを強制。

### ライブラリの既知の問題への回避策

板単位の effect チェーン（`plane.addEffect`）を通した板が上下反転して表示される
（WebGPU / WebGL 2 の両方で再現。原因は未特定だが、`PlaneComposer` の表示用マテリアルが RT を
plane の UV のまま読んでいることが疑わしい）。Visit の見出しでは
`site/FlipYEffect.ts` をチェーン末尾に足して打ち消している。ライブラリ側で直したら外す。

## 起動

リポジトリのルートで:

```bash
npm install
npm run example          # http://localhost:5180 が開く
npm run example:build    # example/dist へ静的ビルド
```

`dom-sync-gl` は `example/vite.config.ts` の alias でリポジトリ直下の `../src` を
直接参照している。ライブラリのソースを編集すれば即サンプルに反映される。

## 検証ページ

`index.html`（HALATION）のほかに、個別機能の動作確認ページがある。
いずれも `vite.config.ts` の `rollupOptions.input` に入口として登録済み。

| パス | 何を確認するか |
|---|---|
| `/dom-test.html` | `attach: 'dom'` が container の CSS 配置を上書きしないこと（fixed 全画面 / 通常フローの 2 ケース） |
| `/pause-offscreen.html` | `pauseWhenOffscreen` が画面外で描画ループごと止め、復帰時に時間軸を継ぎ直すこと |
| `/effects-lib.html` | 同梱エフェクトのカタログ |
| `/text-padding.html` | `DomTextPlane` が対象 DOM の `padding` を余白として引き継ぐこと、`verticalAlign` の 3 モード、溢れ時にクリップしないこと |

`/pause-offscreen.html` は同じ shader の canvas を 2 枚並べ、左だけ `pauseWhenOffscreen: true`
にしてある。2 画面ぶん以上スクロールして離れ、数秒待ってから戻ると、左の `frames` / `uTime` が
止まったままなのに対し右は進み続ける。復帰後も左の `uTime` は**停止時間ぶん遅れたまま**
連続して進む（時間が飛んでいない＝ clock の再シードが効いている）ことが確認できる。

> HUD の時刻は `clock.getElapsedTime()` ではなく `clock.elapsedTime` を読んでいる。
> 前者は内部で `getDelta()` を呼んで時計を進めてしまうため、停止中に呼ぶと
> 「止まっているはずの時計」が動いてしまう。

`/text-padding.html` は板の縁を shader で枠線として描き、DOM 側は `background-clip: content-box`
でコンテンツ領域（padding の内側）だけを塗ってある。枠と塗りの差がそのまま padding として
見えるので、文字が塗りの内側に収まっていれば引き継ぎが効いていると判断できる。
スライダーは CSS 変数を書き換えて `refreshStyle()` で板へ反映する。

> 改行位置はブラウザ自身に決めさせている（`layoutLinesDom()`）ので DOM と一致する。
> カード 06 は `hideElementText: false` で DOM の白文字と GL の赤文字を重ね、
> 折り返しを伴う長文でも行ごとに一致することを確認するためのもの。
> 行の縦位置だけは canvas の `textBaseline: middle` 基準なので、DOM の
> half-leading とわずかにずれる。

## 構成

```
example/
├─ index.html              HALATION のマークアップ
├─ vite.config.ts          root + dom-sync-gl alias + マルチページ入口
├─ tsconfig.json           alias と同じ解決を tsc / エディタにも与える
└─ src/
   ├─ main.ts              ライブラリの初期化・1 本の rAF・各モジュールの配線
   └─ site/
      ├─ env.ts            環境フラグ（動きの抑制・ポインタ・DPR・オクターブ数）と補間関数
      ├─ uniforms.ts       全マテリアルで共有する uniform（時計・速度・章の色）
      ├─ FinishEffect.ts   仕上げ post effect（色収差・走査線・グレイン・イントロ遷移）
      ├─ FlipYEffect.ts    板単位 effect の上下反転の回避策
      ├─ textures.ts       Process の図版（Canvas 2D）
      ├─ style.css         スタイル
      ├─ tsl/              TSL ノード（noise / background / exhibits / type / flare）
      ├─ gl/               章ごとの GL パーツ（hero / exhibits / process / sections）
      └─ ui/               DOM 側（intro / chapters / manifesto / gallery / cursor）
```

`tsconfig.json` の `paths` は `vite.config.ts` の alias と同じく `dom-sync-gl` を `../src` に
向けている。これが無いとエディタが publish 済みの `dist/index.d.ts` を見にいってしまい、
`src` の最新 API が「存在しない」と誤判定される。
