# Graph Report - dom-sync-gl  (2026-08-03)

## Corpus Check
- 114 files · ~69,557 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1071 nodes · 1742 edges · 79 communities (55 shown, 24 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 63 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `44a461f3`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- RipplePostEffect
- BaseEffect
- main.ts
- graphify build pipeline (Steps 0-9)
- FluidSim
- PointerController
- DomSyncGL
- StubRenderer
- DomTextPlane.ts
- LiquidSwap
- DomTextPlane.test.ts
- src/index.ts
- compilerOptions
- DomPositionCalculator
- ditherCursorNodes.ts
- PixelTrailEffect
- compilerOptions
- Core.test.ts
- scroll-wiring.test.ts
- devDependencies
- StickerPeel
- DemoScrollSync.vue
- BaseEffect
- DomTextPlane (createTextPlane)
- Dom3DObject
- ScrollSync
- FeedbackBuffer
- EffectComposer.ts
- BaseEffect.ts
- SmoothCursorEffect
- constants.ts
- EffectManager
- MockWebGPURenderer
- package.json
- scripts
- PlaneComposer
- DomPlane.test.ts
- ScrollSync
- example/tsconfig.json
- peerDependencies
- keywords
- DomSyncGL (API doc)
- DOM-locked Plane Demo
- BaseEffect (post effect authoring)
- FeedbackBuffer (texture generator)
- Camera
- ScrollSync layer
- Single rAF loop (Lenis integration)
- CreatePlaneOptions
- DomTextPlane
- getComputedStyle rasterization pipeline
- dom-test.ts
- DevTools
- effects-lib.ts
- Demos Catalog
- FeedbackBuffer.ts
- effectsLib test page
- peerDependenciesMeta
- PlaneComposer (per-plane FBO chain)
- DomTextPlane
- BaseEffectConfig
- FalkorDB export
- Token reduction benchmark
- EffectTarget
- MouseEffect
- FontLoader.ts
- ditherCursorEffect.ts
- gui
- MockWebGPURenderer
- EffectComposer
- v0.3 to v0.4 Breaking Changes
- shaders.ts
- FilmEffect

## God Nodes (most connected - your core abstractions)
1. `DomSyncGL` - 69 edges
2. `BaseEffect` - 58 edges
3. `DomPlane` - 49 edges
4. `PointerController` - 29 edges
5. `BaseEffectConfig` - 29 edges
6. `Dom3DObject` - 22 edges
7. `FeedbackBuffer` - 20 edges
8. `ScrollSync` - 20 edges
9. `LiquidSwap` - 20 edges
10. `DomPositionCalculator` - 18 edges

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

## Communities (79 total, 24 thin omitted)

### Community 0 - "RipplePostEffect"
Cohesion: 0.16
Nodes (9): packState, unpackH, unpackHPrev, rippleApplyNode(), RippleApplyOptions, placeholderTexture, RipplePostEffect, RipplePostEffectOptions (+1 more)

### Community 1 - "BaseEffect"
Cohesion: 0.06
Nodes (3): DomPlane, BaseEffect, FeedbackOptions

### Community 2 - "main.ts"
Cohesion: 0.10
Nodes (16): app, counter, cursor, demoSpaceMonoReady, film, fontFaceDemoEl, heroPlane, heroStrength (+8 more)

### Community 3 - "graphify build pipeline (Steps 0-9)"
Cohesion: 0.07
Nodes (42): graphify slash-command trigger (.claude/CLAUDE.md), /graphify add (URL ingestion), --watch auto-rebuild, MCP stdio server (graphify.serve), Wiki export, Confidence score rubric, Extraction subagent prompt, Hyperedges (+34 more)

### Community 4 - "FluidSim"
Cohesion: 0.10
Nodes (6): DoubleFBO, FluidSim, FluidStepParams, hsvToRGB(), SplashCursorEffect, SplashCursorEffectOptions

### Community 5 - "PointerController"
Cohesion: 0.10
Nodes (7): PointerController, Harness, makeCanvas(), makeHarness(), makePlaneMock(), makeRaycastHarness(), RaycastHarness

### Community 8 - "DomTextPlane.ts"
Cohesion: 0.22
Nodes (8): MockCtx, buildFontSpec(), layoutLines(), num(), rasterizeText(), ResolvedTextStyle, resolveTextStyle(), TextStyleOverrides

### Community 9 - "LiquidSwap"
Cohesion: 0.11
Nodes (9): coverUv, hash21, imageSizeOf(), LiquidSwap, LiquidSwapOptions, loadLiquidSwapTexture(), placeholderTexture, sharedLoader (+1 more)

### Community 11 - "src/index.ts"
Cohesion: 0.20
Nodes (16): AddFeedbackOptions, placeholderTexture, RESERVED_UNIFORM_NAMES, sharedTextureLoader, FeedbackBufferOptions, Light, PointerType, ScrollSyncOptions (+8 more)

### Community 12 - "compilerOptions"
Cohesion: 0.08
Nodes (23): DOM, DOM.Iterable, ES2020, compilerOptions, allowImportingTsExtensions, forceConsistentCasingInFileNames, isolatedModules, lib (+15 more)

### Community 13 - "DomPositionCalculator"
Cohesion: 0.11
Nodes (4): DEFAULT_OFFSET, DEFAULT_SCALE, DomPositionCalculator, WithInternals

### Community 14 - "ditherCursorNodes.ts"
Cohesion: 0.24
Nodes (10): bayer2(), bayer8(), curlNoise, ditherDisplayNode(), DitherDisplayNodes, ditherSimNode(), DitherSimNodes, mod289() (+2 more)

### Community 15 - "PixelTrailEffect"
Cohesion: 0.11
Nodes (5): PixelTrailEffect, PixelTrailEffectOptions, TrailPoint, TrailTexture, TrailTextureOptions

### Community 16 - "compilerOptions"
Cohesion: 0.09
Nodes (21): ES2022, node, vite.config.ts, vitest.config.ts, compilerOptions, allowImportingTsExtensions, forceConsistentCasingInFileNames, isolatedModules (+13 more)

### Community 19 - "devDependencies"
Cohesion: 0.10
Nodes (21): jsdom, lenis, devDependencies, jsdom, lenis, @types/node, @types/stats.js, @types/three (+13 more)

### Community 20 - "StickerPeel"
Cohesion: 0.14
Nodes (4): coverSample(), placeholderTexture, StickerPeel, StickerPeelOptions

### Community 21 - "DemoScrollSync.vue"
Cohesion: 0.11
Nodes (9): GrainEffect, grainOn, stage, card, cards, colors, inner, scroller (+1 more)

### Community 22 - "BaseEffect"
Cohesion: 0.15
Nodes (17): BaseEffect, Built-in runtime state (uTime / uMouse / width / height), EffectComposer / EffectPass (low-level), BaseEffect feedback buffer, HalfFloat default for feedback buffers, feedback.node evaluation timing, getConfig(): BaseEffectConfig, BaseEffect helpers (setUniform / getUniform / getPass / enabled) (+9 more)

### Community 23 - "DomTextPlane (createTextPlane)"
Cohesion: 0.15
Nodes (16): Scroll Sync Demo, updateRectEveryFrame option, createPlane(null) fullscreen background plane, Style read from getComputedStyle (clamp() resolves), Pitfall: DOM opacity does not affect the GL text plane, DOM text preserved (color: transparent, a11y intact), DomTextPlane (createTextPlane), loadFont() separated from DomTextPlane (+8 more)

### Community 26 - "FeedbackBuffer"
Cohesion: 0.06
Nodes (6): FeedbackBuffer, FeedbackEffect, FeedbackInternals, RendererMock, StateEffect, TestEffect

### Community 28 - "BaseEffect.ts"
Cohesion: 0.15
Nodes (5): FeedbackNodeContext, placeholderTexture, _sizeScratch, StateEffect, TestEffect

### Community 29 - "SmoothCursorEffect"
Cohesion: 0.20
Nodes (5): SmoothCursorEffect, SmoothCursorEffectOptions, segDist, smoothCursorNode(), SmoothCursorNodeUniforms

### Community 30 - "constants.ts"
Cohesion: 0.32
Nodes (8): AMBIENT_LIGHT_COLOR, AMBIENT_LIGHT_INTENSITY, CAMERA_FAR, CAMERA_FOV, CAMERA_NEAR, DIRECTIONAL_LIGHT_COLOR, DIRECTIONAL_LIGHT_INTENSITY, DIRECTIONAL_LIGHT_POSITION

### Community 33 - "package.json"
Cohesion: 0.15
Nodes (12): description, exports, files, license, main, module, name, sideEffects (+4 more)

### Community 34 - "scripts"
Cohesion: 0.15
Nodes (13): scripts, build, build:watch, dev, docs:build, docs:dev, docs:preview, example (+5 more)

### Community 37 - "ScrollSync"
Cohesion: 0.25
Nodes (10): DomPlane, createPlane(selector, options?), DomSyncGL getters (scene/camera/renderer/mouse/scroll), attach ('translate' | 'dom'), ScrollSync.computeEffectiveScrollY(), overscan, ScrollSync, strength / trackStrength (+2 more)

### Community 38 - "example/tsconfig.json"
Cohesion: 0.18
Nodes (10): compilerOptions, paths, types, extends, include, src, vite/client, dom-sync-gl (+2 more)

### Community 39 - "peerDependencies"
Cohesion: 0.20
Nodes (10): lil-gui, lil-gui, stats.js, three, peerDependencies, lil-gui, stats.js, three (+2 more)

### Community 40 - "keywords"
Cohesion: 0.20
Nodes (10): keywords, dom-sync, domsyncgl, post-effect, scroll-sync, shader, three.js, tsl (+2 more)

### Community 42 - "DomSyncGL (API doc)"
Cohesion: 0.28
Nodes (9): build job (npm ci + docs:build), deploy job (github-pages environment), Deploy docs to GitHub Pages workflow, DomSyncGL (API doc), isWebGPUBackend(), ready (async init Promise), update(time?) / render(options?), domSyncGL (library overview) (+1 more)

### Community 43 - "DOM-locked Plane Demo"
Cohesion: 0.22
Nodes (9): Declaration-free Builtin TSL Nodes (uTime / uMouseUV / uIsHovered ...), app.destroy() on plane unmount, DOM-locked Plane Demo, Raycast-driven hover detection, stage requires position: relative, uIsHovered is a float (0 / 1), TSL node-factory shader contract, GLSL to TSL correspondence table (+1 more)

### Community 44 - "BaseEffect (post effect authoring)"
Cohesion: 0.31
Nodes (9): Effect chain order = addEffect order (ping-pong RT), enabled = false is a pass-through, GrainEffect Post Effect Demo, ctx.inputTexture receives previous pass output, setupGUI with lil-gui (demo), BaseEffect migration (tDiffuse to ctx.inputTexture), BaseEffect (post effect authoring), BaseEffect.enabled skip (resources retained) (+1 more)

### Community 45 - "FeedbackBuffer (texture generator)"
Cohesion: 0.22
Nodes (8): forceWebGL debug option, app.ready Promise (async init), WebGPU default with WebGL 2 auto-fallback, Initialization became async (ready), FeedbackBuffer (texture generator), Feedback outputNode ctx nodes (uPrev / uMouse / uHover ...), Ping-pong RenderTarget only, no compute shader, post (sink) vs generator (source) distinction

### Community 47 - "ScrollSync layer"
Cohesion: 0.29
Nodes (8): Lenis + Core unified into one rAF (demo), scrollSync: true for window scroll, autoRaf: false + tick() self-driven loop, Effective scrollY from documentElement rect top, ScrollSync layer, Lenis integration in a single rAF loop, trackStrength / scroll strength, lenis.raf(time) then app.tick(time) ordering in example

### Community 48 - "Single rAF loop (Lenis integration)"
Cohesion: 0.38
Nodes (7): setupGUI(gui) hook, stats.js / lil-gui instance injection, tick(time?), Lenis integration (single rAF), RafScroll (removed), Peer dependency / bundle policy, Single rAF loop (Lenis integration)

### Community 49 - "CreatePlaneOptions"
Cohesion: 0.29
Nodes (7): CreatePlaneOptions, data-texture attribute loading, setTexture / reloadTexture, textureColorSpace default (SRGBColorSpace), create3DObject(selector, options), CreateTextPlaneOptions, TextStyleOverrides

### Community 50 - "DomTextPlane"
Cohesion: 0.29
Nodes (7): createTextPlane(selector, options?), DomTextPlane, document.fonts.ready wait before first rasterize, FontFaceSource, loadFont(), Font loading separated from DomTextPlane, DOM text plane (README)

### Community 51 - "getComputedStyle rasterization pipeline"
Cohesion: 0.33
Nodes (7): color: transparent text hiding, getComputedStyle rasterization pipeline, Text layout rules (paragraphs, wrapping, 4096px clamp), layoutLines(), rasterizeText(), resolveTextStyle(), Public exports surface

### Community 52 - "dom-test.ts"
Cohesion: 0.29
Nodes (4): app, inlineApp, inlineSync, sync

### Community 54 - "effects-lib.ts"
Cohesion: 0.16
Nodes (6): app, EffectDef, EFFECTS, requested, MouseFlowEffect, MouseFlowEffectOptions

### Community 55 - "Demos Catalog"
Cohesion: 0.40
Nodes (6): Demo Page Reading Order (Demo / Code / Points), Demos Catalog, Install (dom-sync-gl + three >= 0.178.0), three peerDependency raised to >=0.178.0, domSyncGL (project home page), Feature list (DOM-locked plane / fallback / scroll sync / text planes / post effects)

### Community 56 - "FeedbackBuffer.ts"
Cohesion: 0.18
Nodes (4): FeedbackContext, FeedbackInput, RESERVED_UNIFORM_NAMES, MouseMotion

### Community 57 - "effectsLib test page"
Cohesion: 0.40
Nodes (6): attach: 'dom' mode (respect container CSS), overscan: 'auto' for mobile URL bar, attach: 'dom' fullscreen/inline test page, .js-demo-image plane lock target, effectsLib effect catalog (pixelTrail / ripple / liquidSwap / stickerPeel ...), effectsLib test page

### Community 58 - "peerDependenciesMeta"
Cohesion: 0.40
Nodes (5): optional, peerDependenciesMeta, lil-gui, stats.js, optional

### Community 59 - "PlaneComposer (per-plane FBO chain)"
Cohesion: 0.67
Nodes (4): Do not reuse one effect instance across targets, Per-plane effect chain (plane.addEffect), 1 effect = 1 plane / app (double registration throws), PlaneComposer (per-plane FBO chain)

### Community 61 - "BaseEffectConfig"
Cohesion: 0.24
Nodes (5): TextHoverEffect, filmNode(), textHoverNode(), BaseEffectConfig, TestEffect

### Community 71 - "FontLoader.ts"
Cohesion: 0.29
Nodes (7): fontCacheKey(), FontFaceSource, fontLoadCache, loadFont(), loadSingleFontFace(), __resetFontLoadCacheForTests(), MockFontFace

### Community 76 - "v0.3 to v0.4 Breaking Changes"
Cohesion: 0.47
Nodes (6): Node graph built once, updated via .value swap, PlaneNodeContext builtin node table, addFeedback migration: pre-declare texture() node, v0.3 to v0.4 Breaking Changes, createPlane shader migration (fragmentShader to colorNode), textureColorSpace default changed to SRGBColorSpace

### Community 77 - "shaders.ts"
Cohesion: 0.47
Nodes (5): fbm, hash, heroColorNode(), vnoise, workColorNode()

## Knowledge Gaps
- **168 isolated node(s):** `stage`, `grainOn`, `card`, `scroller`, `inner` (+163 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **24 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DomSyncGL` connect `DomSyncGL` to `BaseEffect`, `main.ts`, `DomPlane.test.ts`, `PointerController`, `.constructor`, `DomTextPlane.test.ts`, `src/index.ts`, `Camera`, `Core.test.ts`, `scroll-wiring.test.ts`, `dom-test.ts`, `DevTools`, `effects-lib.ts`, `Dom3DObject`, `ScrollSync`, `EffectManager`?**
  _High betweenness centrality (0.126) - this node is a cross-community bridge._
- **Why does `BaseEffect` connect `BaseEffect` to `RipplePostEffect`, `PlaneComposer`, `FluidSim`, `EffectTarget`, `MouseEffect`, `DomPlane.test.ts`, `ditherCursorEffect.ts`, `src/index.ts`, `FilmEffect`, `PixelTrailEffect`, `Core.test.ts`, `SmoothCursorEffect`, `effects-lib.ts`, `FeedbackBuffer`, `BaseEffect.ts`, `BaseEffectConfig`, `EffectManager`?**
  _High betweenness centrality (0.087) - this node is a cross-community bridge._
- **Why does `DomPlane` connect `BaseEffect` to `PlaneComposer`, `DomPlane.test.ts`, `PointerController`, `DomSyncGL`, `DomTextPlane.ts`, `src/index.ts`, `DomPositionCalculator`, `Camera`, `scroll-wiring.test.ts`, `StickerPeel`, `FeedbackBuffer`, `DomTextPlane`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **What connects `stage`, `grainOn`, `card` to the rest of the system?**
  _168 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `BaseEffect` be split into smaller, more focused modules?**
  _Cohesion score 0.06397306397306397 - nodes in this community are weakly interconnected._
- **Should `main.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `graphify build pipeline (Steps 0-9)` be split into smaller, more focused modules?**
  _Cohesion score 0.07317073170731707 - nodes in this community are weakly interconnected._