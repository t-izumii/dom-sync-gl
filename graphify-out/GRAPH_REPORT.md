# Graph Report - .  (2026-07-31)

## Corpus Check
- 116 files · ~66,051 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1057 nodes · 1712 edges · 69 communities (53 shown, 16 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 63 edges (avg confidence: 0.85)
- Token cost: 212,816 input · 43,300 output

## Community Hubs (Navigation)
- カーソル/マウス系エフェクト
- DomPlane ライフサイクルと tick
- サンプルアプリ main エントリ
- graphify スキル パイプライン
- SplashCursor 流体シミュレーション
- PointerController と入力テスト
- DomSyncGL 公開 API
- FeedbackBuffer ピンポン
- テキストラスタライズ処理
- LiquidSwap 遷移エフェクト
- DomTextPlane テストモック
- 公開型定義とエクスポート
- TypeScript 設定 (アプリ)
- DOM 位置計算
- DitherCursor エフェクトノード
- PixelTrail とトレイルテクスチャ
- TypeScript 設定 (Node)
- コア統合テスト
- スクロール配線テスト
- 開発依存パッケージ
- StickerPeel エフェクト
- VitePress デモコンポーネント
- エフェクト/フィードバック API 文書
- テキストプレーン ガイドと落とし穴
- Dom3DObject モデル読み込み
- ScrollSync 実装
- BaseEffect テスト
- EffectComposer テスト
- BaseEffect 本体と Manager テスト
- SmoothCursor エフェクト
- カメラ・ライト定数
- EffectManager ポスト処理
- DomPlane テスト用レンダラモック
- パッケージメタ情報
- npm スクリプト
- PlaneComposer と EffectPass
- DomPlane テスト
- Plane/Scroll API 文書
- サンプル TypeScript 設定
- peer 依存 (three, lil-gui)
- パッケージキーワード
- docs デプロイと WebGPU フォールバック
- Plane デモと TSL 契約
- ポストエフェクト デモ文書
- 非同期初期化とフィードバック指針
- シーン・カメラ基底クラス
- Lenis スクロール連携文書
- 単一 rAF と GUI 注入文書
- テクスチャと色空間オプション
- loadFont とテキストプレーン API
- テキストレイアウトとスタイル解決
- DOM アタッチ検証サンプル
- DevTools 統計と GUI
- EffectComposer 本体
- ドキュメント目次とインストール
- v0.4 移行の破壊的変更
- attach:'dom' と overscan
- 任意 peer 依存
- 1エフェクト1ターゲット規則
- FeedbackEffect テストフィクスチャ
- グラフDBエクスポート (Neo4j/FalkorDB)
- トークン削減ベンチマーク

## God Nodes (most connected - your core abstractions)
1. `DomSyncGL` - 64 edges
2. `BaseEffect` - 57 edges
3. `DomPlane` - 46 edges
4. `PointerController` - 29 edges
5. `BaseEffectConfig` - 29 edges
6. `Dom3DObject` - 22 edges
7. `FeedbackBuffer` - 19 edges
8. `ScrollSync` - 19 edges
9. `DomPositionCalculator` - 18 edges
10. `DomTextPlane` - 18 edges

## Surprising Connections (you probably didn't know these)
- `feedback.node evaluation timing` --semantically_similar_to--> `Single rAF loop (Lenis integration)`  [INFERRED] [semantically similar]
  docs/api/base-effect.md → README.md
- `.js-demo-image plane lock target` --conceptually_related_to--> `DOM-locked Plane Demo`  [INFERRED]
  example/effects-lib.html → docs/demos/plane.md
- `.work__visual DOM hooks for locked planes` --implements--> `DOM-locked Plane Demo`  [INFERRED]
  example/index.html → docs/demos/plane.md
- `effectsLib effect catalog (pixelTrail / ripple / liquidSwap / stickerPeel ...)` --conceptually_related_to--> `FeedbackBuffer (texture generator)`  [INFERRED]
  example/effects-lib.html → docs/guide/post-effects.md
- `No data-reveal on text-plane paragraphs` --semantically_similar_to--> `Pitfall: HTML indentation newlines become paragraphs`  [INFERRED] [semantically similar]
  example/index.html → docs/guide/text-planes.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **graphify build pipeline (detect to report)** — _claude_skills_graphify_skill_pipeline, _claude_skills_graphify_skill_ast_extraction, _claude_skills_graphify_skill_semantic_extraction, _claude_skills_graphify_skill_community_detection, _claude_skills_graphify_skill_graph_health_check, _claude_skills_graphify_skill_manifest [EXTRACTED 1.00]
- **DOM-locked rendering stack** — docs_api_dom_sync_gl_domsyncgl, docs_api_dom_plane_domplane, docs_api_dom_text_plane_domtextplane, docs_api_scroll_scrollsync, docs_api_dom_sync_gl_create3dobject [INFERRED 0.95]
- **TSL post effect chain** — docs_api_base_effect_baseeffect, docs_api_base_effect_getconfig, docs_api_base_effect_feedback_buffer, docs_api_base_effect_effectcomposer, docs_api_dom_sync_gl_addeffect, docs_api_dom_plane_addeffect [EXTRACTED 1.00]
- **TSL node-factory shader contract across plane / effect / feedback** — docs_guide_getting_started_tsl_shader_contract, docs_guide_getting_started_plane_node_context, docs_guide_post_effects_base_effect, docs_guide_post_effects_feedback_ctx_nodes, docs_guide_migration_v0_4_glsl_to_tsl_map [INFERRED 0.85]
- **Single-rAF scroll alignment flow (Lenis then app.tick)** — docs_guide_scroll_sync_lenis_integration, docs_demos_scroll_sync_lenis_single_raf, example_readme_lenis_raf_order, docs_guide_getting_started_auto_raf, docs_guide_scroll_sync_effective_scroll_y [INFERRED 0.85]
- **Ping-pong render-target effect pipeline (post sink + feedback generator)** — docs_guide_post_effects_base_effect, docs_guide_post_effects_plane_composer, docs_guide_post_effects_feedback_buffer, docs_guide_post_effects_post_vs_generator, docs_demos_post_effect_chain_order [INFERRED 0.85]

## Communities (69 total, 16 thin omitted)

### Community 0 - "カーソル/マウス系エフェクト"
Cohesion: 0.05
Nodes (18): app, EffectDef, EFFECTS, gui, requested, MouseEffect, MouseEffectOptions, MouseFlowEffect (+10 more)

### Community 1 - "DomPlane ライフサイクルと tick"
Cohesion: 0.07
Nodes (3): DomPlane, BaseEffect, FeedbackOptions

### Community 2 - "サンプルアプリ main エントリ"
Cohesion: 0.06
Nodes (33): FilmEffect, TextHoverEffect, app, counter, cursor, demoSpaceMonoReady, film, fontFaceDemoEl (+25 more)

### Community 3 - "graphify スキル パイプライン"
Cohesion: 0.07
Nodes (42): graphify slash-command trigger (.claude/CLAUDE.md), /graphify add (URL ingestion), --watch auto-rebuild, MCP stdio server (graphify.serve), Wiki export, Confidence score rubric, Extraction subagent prompt, Hyperedges (+34 more)

### Community 4 - "SplashCursor 流体シミュレーション"
Cohesion: 0.10
Nodes (6): DoubleFBO, FluidSim, FluidStepParams, hsvToRGB(), SplashCursorEffect, SplashCursorEffectOptions

### Community 5 - "PointerController と入力テスト"
Cohesion: 0.10
Nodes (7): PointerController, Harness, makeCanvas(), makeHarness(), makePlaneMock(), makeRaycastHarness(), RaycastHarness

### Community 8 - "テキストラスタライズ処理"
Cohesion: 0.15
Nodes (9): DomTextPlane, MockCtx, buildFontSpec(), layoutLines(), num(), rasterizeText(), ResolvedTextStyle, resolveTextStyle() (+1 more)

### Community 9 - "LiquidSwap 遷移エフェクト"
Cohesion: 0.11
Nodes (9): coverUv, hash21, imageSizeOf(), LiquidSwap, LiquidSwapOptions, loadLiquidSwapTexture(), placeholderTexture, sharedLoader (+1 more)

### Community 11 - "公開型定義とエクスポート"
Cohesion: 0.20
Nodes (17): AddFeedbackOptions, placeholderTexture, RESERVED_UNIFORM_NAMES, sharedTextureLoader, FeedbackBufferOptions, FeedbackContext, FeedbackInput, RESERVED_UNIFORM_NAMES (+9 more)

### Community 12 - "TypeScript 設定 (アプリ)"
Cohesion: 0.08
Nodes (23): DOM, DOM.Iterable, ES2020, compilerOptions, allowImportingTsExtensions, forceConsistentCasingInFileNames, isolatedModules, lib (+15 more)

### Community 13 - "DOM 位置計算"
Cohesion: 0.11
Nodes (5): DEFAULT_OFFSET, DEFAULT_SCALE, DomPositionCalculator, WithInternals, DOMPositionInfo

### Community 14 - "DitherCursor エフェクトノード"
Cohesion: 0.14
Nodes (12): DitherCursorEffect, DitherCursorEffectOptions, bayer2(), bayer8(), curlNoise, ditherDisplayNode(), DitherDisplayNodes, ditherSimNode() (+4 more)

### Community 15 - "PixelTrail とトレイルテクスチャ"
Cohesion: 0.11
Nodes (5): PixelTrailEffect, PixelTrailEffectOptions, TrailPoint, TrailTexture, TrailTextureOptions

### Community 16 - "TypeScript 設定 (Node)"
Cohesion: 0.09
Nodes (21): ES2022, node, vite.config.ts, vitest.config.ts, compilerOptions, allowImportingTsExtensions, forceConsistentCasingInFileNames, isolatedModules (+13 more)

### Community 17 - "コア統合テスト"
Cohesion: 0.09
Nodes (3): CoreInternals, MockWebGPURenderer, TestEffect

### Community 19 - "開発依存パッケージ"
Cohesion: 0.10
Nodes (21): jsdom, lenis, devDependencies, jsdom, lenis, @types/node, @types/stats.js, @types/three (+13 more)

### Community 20 - "StickerPeel エフェクト"
Cohesion: 0.14
Nodes (4): coverSample(), placeholderTexture, StickerPeel, StickerPeelOptions

### Community 21 - "VitePress デモコンポーネント"
Cohesion: 0.11
Nodes (9): GrainEffect, grainOn, stage, card, cards, colors, inner, scroller (+1 more)

### Community 22 - "エフェクト/フィードバック API 文書"
Cohesion: 0.15
Nodes (17): BaseEffect, Built-in runtime state (uTime / uMouse / width / height), EffectComposer / EffectPass (low-level), BaseEffect feedback buffer, HalfFloat default for feedback buffers, feedback.node evaluation timing, getConfig(): BaseEffectConfig, BaseEffect helpers (setUniform / getUniform / getPass / enabled) (+9 more)

### Community 23 - "テキストプレーン ガイドと落とし穴"
Cohesion: 0.15
Nodes (16): Scroll Sync Demo, updateRectEveryFrame option, createPlane(null) fullscreen background plane, Style read from getComputedStyle (clamp() resolves), Pitfall: DOM opacity does not affect the GL text plane, DOM text preserved (color: transparent, a11y intact), DomTextPlane (createTextPlane), loadFont() separated from DomTextPlane (+8 more)

### Community 26 - "BaseEffect テスト"
Cohesion: 0.13
Nodes (4): FeedbackInternals, RendererMock, StateEffect, TestEffect

### Community 27 - "EffectComposer テスト"
Cohesion: 0.18
Nodes (3): EffectContext, EffectOptions, EffectTarget

### Community 28 - "BaseEffect 本体と Manager テスト"
Cohesion: 0.16
Nodes (6): BaseEffectConfig, FeedbackNodeContext, placeholderTexture, _sizeScratch, StateEffect, TestEffect

### Community 29 - "SmoothCursor エフェクト"
Cohesion: 0.20
Nodes (5): SmoothCursorEffect, SmoothCursorEffectOptions, segDist, smoothCursorNode(), SmoothCursorNodeUniforms

### Community 30 - "カメラ・ライト定数"
Cohesion: 0.25
Nodes (9): AMBIENT_LIGHT_COLOR, AMBIENT_LIGHT_INTENSITY, CAMERA_FAR, CAMERA_FOV, CAMERA_NEAR, DIRECTIONAL_LIGHT_COLOR, DIRECTIONAL_LIGHT_INTENSITY, DIRECTIONAL_LIGHT_POSITION (+1 more)

### Community 33 - "パッケージメタ情報"
Cohesion: 0.15
Nodes (12): description, exports, files, license, main, module, name, sideEffects (+4 more)

### Community 34 - "npm スクリプト"
Cohesion: 0.15
Nodes (13): scripts, build, build:watch, dev, docs:build, docs:dev, docs:preview, example (+5 more)

### Community 37 - "Plane/Scroll API 文書"
Cohesion: 0.25
Nodes (10): DomPlane, createPlane(selector, options?), DomSyncGL getters (scene/camera/renderer/mouse/scroll), attach ('translate' | 'dom'), ScrollSync.computeEffectiveScrollY(), overscan, ScrollSync, strength / trackStrength (+2 more)

### Community 38 - "サンプル TypeScript 設定"
Cohesion: 0.18
Nodes (10): compilerOptions, paths, types, extends, include, src, vite/client, dom-sync-gl (+2 more)

### Community 39 - "peer 依存 (three, lil-gui)"
Cohesion: 0.20
Nodes (10): lil-gui, lil-gui, stats.js, three, peerDependencies, lil-gui, stats.js, three (+2 more)

### Community 40 - "パッケージキーワード"
Cohesion: 0.20
Nodes (10): keywords, dom-sync, domsyncgl, post-effect, scroll-sync, shader, three.js, tsl (+2 more)

### Community 42 - "docs デプロイと WebGPU フォールバック"
Cohesion: 0.28
Nodes (9): build job (npm ci + docs:build), deploy job (github-pages environment), Deploy docs to GitHub Pages workflow, DomSyncGL (API doc), isWebGPUBackend(), ready (async init Promise), update(time?) / render(options?), domSyncGL (library overview) (+1 more)

### Community 43 - "Plane デモと TSL 契約"
Cohesion: 0.22
Nodes (9): Declaration-free Builtin TSL Nodes (uTime / uMouseUV / uIsHovered ...), app.destroy() on plane unmount, DOM-locked Plane Demo, Raycast-driven hover detection, stage requires position: relative, uIsHovered is a float (0 / 1), TSL node-factory shader contract, GLSL to TSL correspondence table (+1 more)

### Community 44 - "ポストエフェクト デモ文書"
Cohesion: 0.31
Nodes (9): Effect chain order = addEffect order (ping-pong RT), enabled = false is a pass-through, GrainEffect Post Effect Demo, ctx.inputTexture receives previous pass output, setupGUI with lil-gui (demo), BaseEffect migration (tDiffuse to ctx.inputTexture), BaseEffect (post effect authoring), BaseEffect.enabled skip (resources retained) (+1 more)

### Community 45 - "非同期初期化とフィードバック指針"
Cohesion: 0.22
Nodes (8): forceWebGL debug option, app.ready Promise (async init), WebGPU default with WebGL 2 auto-fallback, Initialization became async (ready), FeedbackBuffer (texture generator), Feedback outputNode ctx nodes (uPrev / uMouse / uHover ...), Ping-pong RenderTarget only, no compute shader, post (sink) vs generator (source) distinction

### Community 47 - "Lenis スクロール連携文書"
Cohesion: 0.29
Nodes (8): Lenis + Core unified into one rAF (demo), scrollSync: true for window scroll, autoRaf: false + tick() self-driven loop, Effective scrollY from documentElement rect top, ScrollSync layer, Lenis integration in a single rAF loop, trackStrength / scroll strength, lenis.raf(time) then app.tick(time) ordering in example

### Community 48 - "単一 rAF と GUI 注入文書"
Cohesion: 0.38
Nodes (7): setupGUI(gui) hook, stats.js / lil-gui instance injection, tick(time?), Lenis integration (single rAF), RafScroll (removed), Peer dependency / bundle policy, Single rAF loop (Lenis integration)

### Community 49 - "テクスチャと色空間オプション"
Cohesion: 0.29
Nodes (7): CreatePlaneOptions, data-texture attribute loading, setTexture / reloadTexture, textureColorSpace default (SRGBColorSpace), create3DObject(selector, options), CreateTextPlaneOptions, TextStyleOverrides

### Community 50 - "loadFont とテキストプレーン API"
Cohesion: 0.29
Nodes (7): createTextPlane(selector, options?), DomTextPlane, document.fonts.ready wait before first rasterize, FontFaceSource, loadFont(), Font loading separated from DomTextPlane, DOM text plane (README)

### Community 51 - "テキストレイアウトとスタイル解決"
Cohesion: 0.33
Nodes (7): color: transparent text hiding, getComputedStyle rasterization pipeline, Text layout rules (paragraphs, wrapping, 4096px clamp), layoutLines(), rasterizeText(), resolveTextStyle(), Public exports surface

### Community 52 - "DOM アタッチ検証サンプル"
Cohesion: 0.29
Nodes (4): app, inlineApp, inlineSync, sync

### Community 55 - "ドキュメント目次とインストール"
Cohesion: 0.40
Nodes (6): Demo Page Reading Order (Demo / Code / Points), Demos Catalog, Install (dom-sync-gl + three >= 0.178.0), three peerDependency raised to >=0.178.0, domSyncGL (project home page), Feature list (DOM-locked plane / fallback / scroll sync / text planes / post effects)

### Community 56 - "v0.4 移行の破壊的変更"
Cohesion: 0.47
Nodes (6): Node graph built once, updated via .value swap, PlaneNodeContext builtin node table, addFeedback migration: pre-declare texture() node, v0.3 to v0.4 Breaking Changes, createPlane shader migration (fragmentShader to colorNode), textureColorSpace default changed to SRGBColorSpace

### Community 57 - "attach:'dom' と overscan"
Cohesion: 0.40
Nodes (6): attach: 'dom' mode (respect container CSS), overscan: 'auto' for mobile URL bar, attach: 'dom' fullscreen/inline test page, .js-demo-image plane lock target, effectsLib effect catalog (pixelTrail / ripple / liquidSwap / stickerPeel ...), effectsLib test page

### Community 58 - "任意 peer 依存"
Cohesion: 0.40
Nodes (5): optional, peerDependenciesMeta, lil-gui, stats.js, optional

### Community 59 - "1エフェクト1ターゲット規則"
Cohesion: 0.67
Nodes (4): Do not reuse one effect instance across targets, Per-plane effect chain (plane.addEffect), 1 effect = 1 plane / app (double registration throws), PlaneComposer (per-plane FBO chain)

## Knowledge Gaps
- **168 isolated node(s):** `stage`, `grainOn`, `card`, `scroller`, `inner` (+163 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DomSyncGL` connect `DomSyncGL 公開 API` to `カーソル/マウス系エフェクト`, `DomPlane ライフサイクルと tick`, `サンプルアプリ main エントリ`, `DomPlane テスト`, `PointerController と入力テスト`, `DomSyncGL 描画ループ`, `DomTextPlane テストモック`, `公開型定義とエクスポート`, `シーン・カメラ基底クラス`, `コア統合テスト`, `スクロール配線テスト`, `DOM アタッチ検証サンプル`, `DevTools 統計と GUI`, `Dom3DObject モデル読み込み`, `ScrollSync 実装`, `DomSyncGL 破棄処理`, `カメラ・ライト定数`, `EffectManager ポスト処理`?**
  _High betweenness centrality (0.119) - this node is a cross-community bridge._
- **Why does `BaseEffect` connect `DomPlane ライフサイクルと tick` to `カーソル/マウス系エフェクト`, `サンプルアプリ main エントリ`, `PlaneComposer と EffectPass`, `SplashCursor 流体シミュレーション`, `DomPlane テスト`, `公開型定義とエクスポート`, `DitherCursor エフェクトノード`, `PixelTrail とトレイルテクスチャ`, `FeedbackEffect テストフィクスチャ`, `コア統合テスト`, `BaseEffect テスト`, `BaseEffect 本体と Manager テスト`, `SmoothCursor エフェクト`, `EffectManager ポスト処理`?**
  _High betweenness centrality (0.106) - this node is a cross-community bridge._
- **Why does `DomPlane` connect `DomPlane ライフサイクルと tick` to `PlaneComposer と EffectPass`, `DomPlane テスト`, `PointerController と入力テスト`, `DomSyncGL 公開 API`, `FeedbackBuffer ピンポン`, `テキストラスタライズ処理`, `公開型定義とエクスポート`, `DOM 位置計算`, `シーン・カメラ基底クラス`, `スクロール配線テスト`, `StickerPeel エフェクト`, `DomSyncGL 破棄処理`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **What connects `stage`, `grainOn`, `card` to the rest of the system?**
  _168 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `カーソル/マウス系エフェクト` be split into smaller, more focused modules?**
  _Cohesion score 0.05493863237872589 - nodes in this community are weakly interconnected._
- **Should `DomPlane ライフサイクルと tick` be split into smaller, more focused modules?**
  _Cohesion score 0.06568832983927324 - nodes in this community are weakly interconnected._
- **Should `サンプルアプリ main エントリ` be split into smaller, more focused modules?**
  _Cohesion score 0.05585106382978723 - nodes in this community are weakly interconnected._