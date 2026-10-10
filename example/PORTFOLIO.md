# Tetsuya Izumi — Code in motion

HALATIONと既存検証ページを保持した独立サンプルです。
泉徹也 / Tetsuya IzumiのCreative Developer / Frontend Engineerとしての
ポートフォリオを、黒・アイボリー・ライムの構図とライブ3Dで制作しています。
Fold / Echo / Matterはこのサイトのための **Concept / デモ** です。
商用実績や受賞歴を示しません。公開連絡先は確認済みのGitHub `t-izumii` のみです。

```sh
# リポジトリのルートから
npm run example -- --host 127.0.0.1 --open /portfolio.html
# http://127.0.0.1:5180/portfolio.html
```

LAN用には同じWi-FiのMacの現在のIPを `--host` に指定します。
作業時のIPは `192.168.150.104`。プレビューは
`http://192.168.150.104:5180/portfolio.html` です。
既に起動している場合は追加起動せず既存URLを使用してください。
この環境では別のアプリがIPv6のlocalhost:5180を使用しているため、
Mac内のプレビューには **127.0.0.1** を明示します。

## DOMと3つのcanvas

- ヒーローはdocument内のabsolute canvas。`scrollSync: {attach:'translate',overscan:'auto'}`。
  通常フローのDOMとcanvasが、RAFの間にも同じネイティブスクロール移動を受けます。
- 横章は `.work-stage` の中のsticky canvas。`scrollSync: {attach:'dom'}`。
  canvasとDOMが同じsticky親を持ち、章の固定／解除に伴う移動を共有します。
  stacked / 長文時もcanvasは1画面の高さで、ページ全長のGPUバッファを作りません。
- 独立した光路はfixed canvas。`attach:'dom'`でCSSのfixedを保持し、
  `fixedApp.addObject()` によりDOMの作品枠を読まず画面空間を構成します。
- 4つのGLB彫刻を実際の `create3DObject(element)` でDOM枠に同期。
  wrapperの座標・サイズをライブラリが管理し、内側の形状だけを変形します。
  `updateRectEveryFrame:true`、描画前の可視判定で横章境界も追従します。
- 1本のRAFで **Lenis → ChapterFrame → DOMのleft → DOM矩形計測／各app.update →
  形状更新 → 可視DOM層とfixed層のrender** を実行します。
  横位置は小数pxを保持し、CSS transitionや位置の追加lerpを使いません。
- `overflow:hidden` はfocus / scrollIntoViewで内部scrollLeftが変化し得るため、
  横章の切り抜きは **overflow:clip**。章ボタンの移動は同じLenisに統一しました。
  タッチの縦スクロールは `syncTouch:false` のネイティブ処理を保ちます。

fixed canvas自体でDOM同期が不可能なわけではありません。
`attach:'dom'`でfixedを尊重し、DOMとcanvasの画面座標を毎フレーム測りrenderすれば追従できます。
このサンプルでは通常フロー、sticky、独立固定の役割に合わせて親とcanvasを分けています。

## シェーダーと負荷

`shaders.ts` のネイティブ **GLSL / WGSL** をTSLの `glslFn / wgslFn` に接続しています。
実際のbackendに合わせ同じ式を選び、別rendererにも同じuniform時計を渡します。

- Foldの流れ場が頂点を変位し、解析的な勾配から法線を補正。
  表面の粗さ、clearcoat、薄膜干渉の厚さを変えて、反射と輪郭が連動します。
- Echo / Matterにも流れ場による表面変化と薄膜反射を適用。
  23輪／39薄板の再構成はInstancedMeshで各1 draw callです。
- 光路はUV上を流れるハイライトと頂点の揺らぎをGPUで描画します。
  全画面FBO、post effect、影用バッファ、外部の高解像度textureは追加していません。
- 通常は可視彫刻1回と光路4回を描画。境界では2作品が見える場合があります。
  同時に常時描画するのは可視DOM層＋fixed層。3canvasを全て常時renderしません。
  環境CubeTextureはrendererごとに別objectで所有し、PMREMを別GPU contextで共有しません。
- DPR上限は通常DOMがPC1.5／coarse1.25、横章がPC1.5／coarse1、独立層がPC1.25／coarse1。
  静止中の自動アニメーションはPC60fps／タッチ30fpsを上限とします。
  **スクロール・横位置・DOM矩形が変化したフレームは間引きません。**
  実際のFPSはGPU・ブラウザ・省電力設定に依存します。
- 画面外、詳細dialog、非表示タブでは連続GPU描画を停止。
  pagehide、bfcache、HMRで3renderer、geometry、material、instance、環境textureを解放します。

## 操作とfallback

- 01 / 02 / 03、ドラッグ、Transform、詳細とNextが動作します。
  詳細はnative dialog、Escape、focus trap／復帰、hash深リンク、Back／Forward対応。
- `prefers-reduced-motion` の実行中変更にも対応。作品は縦に並び、
  自動回転・シェーダー時計・光路・smooth wheelを止めます。
  3Dは静止表示され、Transformの明示操作のみ静的に反映します。
- 本文が長い場合も縦構成に移り、内容を切り捨てません。
- モデルは15秒の読込期限を持ち、読み込めた作品から3Dへ移ります。
  GPU初期化失敗、import失敗、context lossは画像を残し、詳細や章の選択を維持します。
  未読込／壊れた画像にも枠と説明を残します。
- HTTP LANではWebGPU APIが提供されないため、WebGL2で3Dを描画します。
  Three r182が非secure環境で未定義のGPUShaderStageを参照する問題を、
  exampleのbootstrapで標準の数値flagsだけ先に定義して回避。
  navigator.gpu、ブラウザの安全設定、ライブラリ本体、node_modulesは変更していません。
  GPU importを遅延し、production chunkでも初期化順序を保ちます。

## 確認用URL

| URL | 用途 |
|---|---|
| `/portfolio.html` | WebGPU優先・WebGL2 fallback |
| `/portfolio.html?diagnostics` | 描画方式、静止3D／画像、失敗理由、3canvas、再試行 |
| `/portfolio.html?backend=webgl` | WebGL2強制 |
| `/portfolio.html?no-gl` | DOMの静止画像と操作 |
| `/portfolio.html#project-echo` | 詳細への直接リンク |
| `/portfolio.html?debug` | `window.__portfolioDebug` に提出済みフレーム・CPU submit時間・各renderer情報 |
| `/portfolio.html?debug&sync-probe` | DOMシアン枠／GPUマゼンタ目印による表示ピクセル検証 |

診断UIは指定時だけ表示し、通信・保存・telemetryを行いません。
`data-portfolio-renderer` はwebgpu / webgl / dom、`data-portfolio-shader` はnative-wgsl / native-glsl。
CPU更新／submit時間はGPU処理完了時間とは別です。

## 再生成と検証

GLBとPNGは既存のThree.jsでローカル生成。外部画像・フォント配信、画像生成サービス、
トラッキング、音声、追加依存は使いません。

```sh
node example/scripts/create-models.mjs
node example/scripts/render-portfolio-art.mjs
node example/scripts/test-portfolio.mjs
node example/scripts/test-portfolio-sync.mjs
# 起動中のLANアプリを同じ表示ピクセルテストで検証する場合
PORTFOLIO_URL=http://192.168.150.104:5180/portfolio.html node example/scripts/test-portfolio-sync.mjs
npm run typecheck
npx tsc -p example/tsconfig.json --noEmit
npm test
npm run test:gpu
npm run build
npm run example:build
# build済みファイルを実際の非secure LAN originで検証
PORTFOLIO_TEST_HOST=192.168.150.104 node example/scripts/test-portfolio-production.mjs
```

検証スクリプトはMac miniのローカルPlaywright Chromiumを使用。
PNGとJSONは `PORTFOLIO_EVIDENCE_DIR`（未指定ならOSの一時フォルダ）へ保存します。
通常ChromeでもPC／mobile寸法の最終画面、WebGPU／HTTP LAN WebGL2を実見しています。
PC、320–3440px、タッチイベント、resize、履歴、reduced-motion、長文、未読込、
GPU非対応、context loss、破棄・復帰、native shaderのcompileを確認します。
表示ピクセル検証は動的な縦／横スクロールと最後に提出したGPU位置の時系列を比較します。

実機iPhoneから『バグ治ってるかも』との改善報告はありますが、Safariの実機テストを
この環境で完了したという意味ではありません。テスト成功は受賞水準を保証しません。
