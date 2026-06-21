# OBSCURA — domSyncGL sample

`dom-sync-gl` を使って作ったアワードクラスのデジタルスタジオ風サンプルサイト。
ライブラリの主要機能をひと通り使った構成になっている。

## 使っている機能

| 機能 | 使いどころ |
|---|---|
| `DomSyncGL({ scrollSync: { trackStrength: true } })` | スクロール同期 + スクロール速度の取得 |
| `RafScroll` | Lenis ベースのスムーズスクロール |
| `createPlane(null, …)` | ヒーローのフルスクリーン背景シェーダー（viewport 固定）|
| `createPlane('.work__visual', …)` | 各 Work を DOM 要素にロックした procedural な板に |
| `onInView` / `onOutView` | 画面内に入ったら下からワイプして出現 |
| `addEffect(new FilmEffect())` | 色収差 + グレイン + ビネットの仕上げ post effect |
| `addUpdateCallback` / `addResizeCallback` | 毎フレ uniform 更新・解像度同期 |

スクロール速度 (`scrollSync.strength`) を背景・Work・post effect の各 uniform に流し、
速く動かすほど色収差と色味が強まるようにしている。

DOM は基本的に透明にして canvas を覗かせる構成。背景シェーダーをページ全体の地として使い、
`renderOrder` で Work の板を必ず手前に重ねている。

## 起動

リポジトリのルートで:

```bash
npm install
npm run example          # http://localhost:5180 が開く
npm run example:build    # example/dist へ静的ビルド
```

`dom-sync-gl` は `example/vite.config.ts` の alias でリポジトリ直下の `../src` を
直接参照している。ライブラリのソースを編集すれば即サンプルに反映される。

## 構成

```
example/
├─ index.html        マークアップ
├─ vite.config.ts    root + dom-sync-gl alias
└─ src/
   ├─ main.ts        ライブラリの初期化・配線
   ├─ shaders.ts     hero / work / film の GLSL
   ├─ effects.ts     FilmEffect (BaseEffect 継承)
   └─ style.css      スタイル
```
