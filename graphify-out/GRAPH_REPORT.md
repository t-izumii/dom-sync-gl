# Graph Report - dom-sync-gl  (2026-10-15)

## Corpus Check
- 182 files · ~239,437 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1701 nodes · 2810 edges · 123 communities (92 shown, 31 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 76 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `218d01f0`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- fluidKernels.ts
- constants.ts
- FontLoader.ts
- graphify build pipeline (Steps 0-9)
- FluidSim
- PointerController
- DomSyncGL
- DomPlane
- DomTextPlane.ts
- LiquidSwap
- DomTextPlane.test.ts
- src/index.ts
- compilerOptions
- BaseEffect.test.ts
- ditherCursorNodes.ts
- PixelTrailEffect
- compilerOptions
- Core.test.ts
- MockWebGPURenderer
- devDependencies
- StickerPeel
- DemoScrollSync.vue
- BaseEffect
- DomTextPlane (createTextPlane)
- DomPositionCalculator
- ScrollSync
- BaseEffect.ts
- PlaneComposer
- EffectManager.test.ts
- MouseEffect
- BaseEffect
- EffectManager
- MockWebGPURenderer
- package.json
- scripts
- pause-offscreen.ts
- MockWebGPURenderer
- ScrollSync
- example/tsconfig.json
- peerDependencies
- keywords
- DomSyncGL (API doc)
- DOM-locked Plane Demo
- BaseEffect (post effect authoring)
- FeedbackBuffer (texture generator)
- DomPlane.test.ts
- ScrollSync layer
- Single rAF loop (Lenis integration)
- CreatePlaneOptions
- DomTextPlane
- getComputedStyle rasterization pipeline
- dom-test.ts
- DevTools
- MouseFlowEffect
- Demos Catalog
- StubRenderer
- effectsLib test page
- peerDependenciesMeta
- PlaneComposer (per-plane FBO chain)
- StateEffect
- portfolio/main.ts
- FalkorDB export
- Token reduction benchmark
- sections.ts
- FluidWaterEffect
- v0.3 to v0.4 Breaking Changes
- src/main.ts
- tsl/exhibits.ts
- EffectComposer
- Dom3DObject
- PaperCrumple
- WaterRippleEffect
- domSyncGL
- Methods
- chapters.ts
- Methods
- BaseEffect
- SmoothCursorEffect
- test-portfolio.mjs
- glassCursorNode.ts
- effects-lib.ts
- Intro
- ripplePostEffect.ts
- Scroll Sync
- Text Planes
- process.ts
- .addEffect
- RipplePostEffect
- SplashCursorEffect
- DomTextPlane
- Notes
- Migrating from v0.3 (GLSL)
- Post Effects
- DomTextPlane
- DOM-locked Plane
- Getting Started
- splashCursorEffect.ts
- ScrollSync
- Scroll Sync
- BaseEffectConfig
- text-padding.ts
- loadFont
- Tetsuya Izumi — Code in motion
- gpu-regression.ts
- GlassCursorEffect
- test-portfolio-sync.mjs
- Cursor
- Demos
- test-portfolio-production.mjs
- bootstrap.ts
- GpuEffect
- en/index.md
- create-models.mjs
- render-portfolio-art.mjs
- gpu-regression.mjs

## God Nodes (most connected - your core abstractions)
1. `DomSyncGL` - 83 edges
2. `BaseEffect` - 71 edges
3. `DomPlane` - 55 edges
4. `BaseEffectConfig` - 41 edges
5. `PointerController` - 32 edges
6. `Dom3DObject` - 23 edges
7. `PaperCrumple` - 23 edges
8. `DomTextPlane` - 21 edges
9. `ScrollSync` - 21 edges
10. `LiquidSwap` - 21 edges

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

## Communities (123 total, 31 thin omitted)

### Community 0 - "fluidKernels.ts"
Cohesion: 0.08
Nodes (33): FluidCompute, FluidComputeOptions, FluidStepParams, MipmapAwareStorageTexture, TODO: 同一 compute パス内の連続ディスパッチ間バリアが実機で効かない場合は、, SplatPoint, advectionKernel(), AdvectionKernelParams (+25 more)

### Community 1 - "constants.ts"
Cohesion: 0.17
Nodes (10): Camera, AMBIENT_LIGHT_COLOR, AMBIENT_LIGHT_INTENSITY, CAMERA_FAR, CAMERA_FOV, CAMERA_NEAR, DIRECTIONAL_LIGHT_COLOR, DIRECTIONAL_LIGHT_INTENSITY (+2 more)

### Community 2 - "FontLoader.ts"
Cohesion: 0.29
Nodes (7): fontCacheKey(), FontFaceSource, fontLoadCache, loadFont(), loadSingleFontFace(), __resetFontLoadCacheForTests(), MockFontFace

### Community 3 - "graphify build pipeline (Steps 0-9)"
Cohesion: 0.07
Nodes (42): graphify slash-command trigger (.claude/CLAUDE.md), /graphify add (URL ingestion), --watch auto-rebuild, MCP stdio server (graphify.serve), Wiki export, Confidence score rubric, Extraction subagent prompt, Hyperedges (+34 more)

### Community 5 - "PointerController"
Cohesion: 0.09
Nodes (7): PointerController, Harness, makeCanvas(), makeHarness(), makePlaneMock(), makeRaycastHarness(), RaycastHarness

### Community 8 - "DomTextPlane.ts"
Cohesion: 0.23
Nodes (8): MockCtx, buildFontSpec(), layoutLines(), layoutLinesDom(), num(), rasterizeText(), ResolvedTextStyle, resolveTextStyle()

### Community 9 - "LiquidSwap"
Cohesion: 0.11
Nodes (9): coverUv, hash21, imageSizeOf(), LiquidSwap, LiquidSwapOptions, loadLiquidSwapTexture(), placeholderTexture, sharedLoader (+1 more)

### Community 11 - "src/index.ts"
Cohesion: 0.21
Nodes (15): AddFeedbackOptions, placeholderTexture, RESERVED_UNIFORM_NAMES, sharedTextureLoader, FeedbackBufferOptions, Light, PointerType, ScrollSyncOptions (+7 more)

### Community 12 - "compilerOptions"
Cohesion: 0.08
Nodes (23): DOM, DOM.Iterable, ES2020, compilerOptions, allowImportingTsExtensions, forceConsistentCasingInFileNames, isolatedModules, lib (+15 more)

### Community 13 - "BaseEffect.test.ts"
Cohesion: 0.15
Nodes (3): FeedbackEffect, FeedbackInternals, RendererMock

### Community 14 - "ditherCursorNodes.ts"
Cohesion: 0.15
Nodes (12): DitherCursorEffect, DitherCursorEffectOptions, bayer2(), bayer8(), curlNoise, ditherDisplayNode(), DitherDisplayNodes, ditherSimNode() (+4 more)

### Community 15 - "PixelTrailEffect"
Cohesion: 0.09
Nodes (5): PixelTrailEffect, PixelTrailEffectOptions, TrailPoint, TrailTexture, TrailTextureOptions

### Community 16 - "compilerOptions"
Cohesion: 0.09
Nodes (21): ES2022, node, vite.config.ts, vitest.config.ts, compilerOptions, allowImportingTsExtensions, forceConsistentCasingInFileNames, isolatedModules (+13 more)

### Community 19 - "devDependencies"
Cohesion: 0.09
Nodes (23): jsdom, lenis, devDependencies, jsdom, lenis, playwright, @types/node, @types/stats.js (+15 more)

### Community 20 - "StickerPeel"
Cohesion: 0.14
Nodes (4): coverSample(), placeholderTexture, StickerPeel, StickerPeelOptions

### Community 21 - "DemoScrollSync.vue"
Cohesion: 0.08
Nodes (15): GrainEffect, grainOn, isEn, { lang }, stage, card, isEn, { lang } (+7 more)

### Community 22 - "BaseEffect"
Cohesion: 0.15
Nodes (17): BaseEffect, Built-in runtime state (uTime / uMouse / width / height), EffectComposer / EffectPass (low-level), BaseEffect feedback buffer, HalfFloat default for feedback buffers, feedback.node evaluation timing, getConfig(): BaseEffectConfig, BaseEffect helpers (setUniform / getUniform / getPass / enabled) (+9 more)

### Community 23 - "DomTextPlane (createTextPlane)"
Cohesion: 0.15
Nodes (16): Scroll Sync Demo, updateRectEveryFrame option, createPlane(null) fullscreen background plane, Style read from getComputedStyle (clamp() resolves), Pitfall: DOM opacity does not affect the GL text plane, DOM text preserved (color: transparent, a11y intact), DomTextPlane (createTextPlane), loadFont() separated from DomTextPlane (+8 more)

### Community 26 - "BaseEffect.ts"
Cohesion: 0.12
Nodes (8): FeedbackNodeContext, FeedbackOptions, placeholderTexture, _sizeScratch, FeedbackContext, FeedbackInput, RESERVED_UNIFORM_NAMES, MouseMotion

### Community 27 - "PlaneComposer"
Cohesion: 0.12
Nodes (4): EffectContext, EffectOptions, EffectPass, PlaneComposer

### Community 28 - "EffectManager.test.ts"
Cohesion: 0.18
Nodes (3): SizeAwareEffect, StateEffect, TestEffect

### Community 29 - "MouseEffect"
Cohesion: 0.20
Nodes (4): hsvToRGB(), MouseEffect, MouseEffectOptions, placeholderDye

### Community 33 - "package.json"
Cohesion: 0.15
Nodes (12): description, exports, files, license, main, module, name, sideEffects (+4 more)

### Community 34 - "scripts"
Cohesion: 0.14
Nodes (14): scripts, build, build:watch, dev, docs:build, docs:dev, docs:preview, example (+6 more)

### Community 35 - "pause-offscreen.ts"
Cohesion: 0.33
Nodes (4): fmt(), hud(), Panel, panels

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

### Community 46 - "DomPlane.test.ts"
Cohesion: 0.15
Nodes (3): MotionEffect, TestEffect, WithComposer

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

### Community 55 - "Demos Catalog"
Cohesion: 0.40
Nodes (6): Demo Page Reading Order (Demo / Code / Points), Demos Catalog, Install (dom-sync-gl + three >= 0.178.0), three peerDependency raised to >=0.178.0, domSyncGL (project home page), Feature list (DOM-locked plane / fallback / scroll sync / text planes / post effects)

### Community 57 - "effectsLib test page"
Cohesion: 0.40
Nodes (6): attach: 'dom' mode (respect container CSS), overscan: 'auto' for mobile URL bar, attach: 'dom' fullscreen/inline test page, .js-demo-image plane lock target, effectsLib effect catalog (pixelTrail / ripple / liquidSwap / stickerPeel ...), effectsLib test page

### Community 58 - "peerDependenciesMeta"
Cohesion: 0.40
Nodes (5): optional, peerDependenciesMeta, lil-gui, stats.js, optional

### Community 59 - "PlaneComposer (per-plane FBO chain)"
Cohesion: 0.67
Nodes (4): Do not reuse one effect instance across targets, Per-plane effect chain (plane.addEffect), 1 effect = 1 plane / app (double registration throws), PlaneComposer (per-plane FBO chain)

### Community 61 - "portfolio/main.ts"
Cohesion: 0.08
Nodes (23): closeProject(), fine, frame(), last, lenis, lifetime, motion, ProjectId (+15 more)

### Community 70 - "sections.ts"
Cohesion: 0.12
Nodes (22): buildScene(), reduced(), syncCursor(), COARSE, layer, Part, Smoothed, createExhibits() (+14 more)

### Community 71 - "FluidWaterEffect"
Cohesion: 0.10
Nodes (6): FluidWaterEffect, FluidWaterEffectOptions, mirrorRepeat(), DoubleFBO, WaterFluidSim, WaterFluidStepParams

### Community 72 - "v0.3 to v0.4 Breaking Changes"
Cohesion: 0.47
Nodes (6): Node graph built once, updated via .value swap, PlaneNodeContext builtin node table, addFeedback migration: pre-declare texture() node, v0.3 to v0.4 Breaking Changes, createPlane shader migration (fragmentShader to colorNode), textureColorSpace default changed to SRGBColorSpace

### Community 73 - "src/main.ts"
Cohesion: 0.09
Nodes (20): chapters, cursorEl, frame(), galleryEl, intro, last, lenis, lifetime (+12 more)

### Community 74 - "tsl/exhibits.ts"
Cohesion: 0.13
Nodes (19): FinishEffect, createBackgroundNode(), ArtFn, ArtInput, ARTS, aurora(), FrameUniforms, ink() (+11 more)

### Community 76 - "Dom3DObject"
Cohesion: 0.11
Nodes (7): DEFAULT_OFFSET, DEFAULT_SCALE, collectMaterialTextures(), disposeModel(), Dom3DObject, WithScroll, Create3DObjectOptions

### Community 77 - "PaperCrumple"
Cohesion: 0.12
Nodes (8): bakeCrumple(), computeNormals(), CrumpleBake, CrumpleBakeOptions, mulberry32(), smoothstep(), PaperCrumple, PaperCrumpleOptions

### Community 78 - "WaterRippleEffect"
Cohesion: 0.11
Nodes (5): mirrorRepeat(), WaterRippleEffect, WaterRippleEffectOptions, WaveSim, WaveStepParams

### Community 79 - "domSyncGL"
Cohesion: 0.09
Nodes (22): API reference, Browser support, Bundle, Concepts, `CreatePlaneOptions`, `CreateTextPlaneOptions`, Develop, DOM-locked plane (+14 more)

### Community 80 - "Methods"
Cohesion: 0.09
Nodes (21): `addEffect(effect)` / `removeEffect(effect)` / `clearEffects()`, `addObject(obj3d)` / `removeObject(obj3d)`, `addUpdateCallback(fn)` / `addResizeCallback(fn)`, Constructor, `create3DObject(selector, options)` / `remove3DObject(obj)`, `createPlane(selector, options?)` / `removePlane(plane)`, `createTextPlane(selector, options?)`, `destroy()` (+13 more)

### Community 81 - "chapters.ts"
Cohesion: 0.13
Nodes (8): clamp01(), Chapters, Mood, moodColors, MOODS, smooth(), Gallery, Manifesto

### Community 82 - "Methods"
Cohesion: 0.12
Nodes (16): `addEffect(effect)` / `removeEffect(effect)`, `addFeedback(options)` / `removeFeedback(buffer)`, CreatePlaneOptions, `destroy()`, DomPlane, `getMesh()`, `getMouseUV()` / `isHovered()`, Methods (+8 more)

### Community 83 - "BaseEffect"
Cohesion: 0.13
Nodes (14): Abstract / overridable, BaseEffect, Built-in runtime state, `dispose?()`, EffectComposer / EffectPass, Feedback buffers, `getConfig(): BaseEffectConfig` _(abstract)_, Helpers (+6 more)

### Community 84 - "SmoothCursorEffect"
Cohesion: 0.20
Nodes (5): SmoothCursorEffect, SmoothCursorEffectOptions, segDist, smoothCursorNode(), SmoothCursorNodeUniforms

### Community 85 - "test-portfolio.mjs"
Cohesion: 0.15
Nodes (5): difference(), errors, expectedGPUloss, png(), results

### Community 86 - "glassCursorNode.ts"
Cohesion: 0.23
Nodes (10): GlassCursorEffectOptions, BASE_SIZE, boxSDF(), glassCursorNode(), GlassCursorNodeUniforms, lensAmount(), MAX_SHIFT_RATIO, over() (+2 more)

### Community 87 - "effects-lib.ts"
Cohesion: 0.15
Nodes (5): app, EffectDef, EFFECTS, gui, requested

### Community 88 - "Intro"
Cohesion: 0.22
Nodes (4): easeInOutCubic(), Intro, IntroTarget, Phase

### Community 89 - "ripplePostEffect.ts"
Cohesion: 0.32
Nodes (8): packState, unpackH, unpackHPrev, rippleApplyNode(), RippleApplyOptions, placeholderTexture, RipplePostEffectOptions, rippleTexture()

### Community 90 - "Scroll Sync"
Cohesion: 0.17
Nodes (11): Demo, Effective scrollY and the iOS Safari rubber-band effect, Enabling it, Keeping the container's CSS with `attach: 'dom'`, Mobile URL bar protection is on by default, Options, Pull-to-refresh keeps working, Scroll Sync (+3 more)

### Community 91 - "Text Planes"
Cohesion: 0.17
Nodes (11): Adding per-plane effects, CSS decides the style, DOM opacity does not affect the plane, Line breaks in the HTML become paragraphs, Loading web fonts dynamically, Next steps, Pitfalls, Text Planes (+3 more)

### Community 92 - "process.ts"
Cohesion: 0.55
Nodes (10): createProcess(), addGrain(), drawBlank(), drawFinal(), drawLight(), drawLightTest(), drawSketch(), makeCanvas() (+2 more)

### Community 96 - "DomTextPlane"
Cohesion: 0.18
Nodes (10): DomTextPlane, How text is handled, Instance members, Line breaks match the DOM, Options, Padding, `TextStyleOverrides`, `verticalAlign` (+2 more)

### Community 97 - "Notes"
Cohesion: 0.18
Nodes (10): 1. Read the previous pass from `ctx.inputTexture`, 2. Chain order = the order of `addEffect` calls, 3. `enabled = false` is a pass-through, 4. You can also build per-plane chains, 5. Adjusting it dynamically with lil-gui, Demo, HTML, Notes (+2 more)

### Community 98 - "Migrating from v0.3 (GLSL)"
Cohesion: 0.18
Nodes (10): Behavior changes, Breaking changes, Example 1: createPlane shaders, Example 2: BaseEffect, Example 3: addFeedback, GLSL → TSL mapping, Initialization is now asynchronous (`ready`), Migrating from v0.3 (GLSL) (+2 more)

### Community 99 - "Post Effects"
Cohesion: 0.18
Nodes (10): A minimal effect, enable / disable, Feedback buffers (generators), lil-gui integration, Nodes passed automatically (ctx of outputNode), Per-plane chains, `plane.addFeedback()`, Post Effects (+2 more)

### Community 101 - "DOM-locked Plane"
Cohesion: 0.20
Nodes (9): 1. Built-in nodes you can use without declaring them, 2. `uIsHovered` is a float (0 / 1), 3. Hover detection is raycast-driven, 4. Destroying planes, Demo, DOM-locked Plane, HTML, Notes (+1 more)

### Community 102 - "Getting Started"
Cohesion: 0.20
Nodes (9): Built-in nodes for colorNode, Getting Started, Install, Minimal code, Next steps, Owning the rAF loop, Turning text into a plane, Using it as a fullscreen background (+1 more)

### Community 103 - "splashCursorEffect.ts"
Cohesion: 0.24
Nodes (3): DoubleFBO, FluidStepParams, SplashCursorEffectOptions

### Community 104 - "ScrollSync"
Cohesion: 0.22
Nodes (8): `attach`, Instance members, Options, `overscan`, Scroll, ScrollSync, static `ScrollSync.computeEffectiveScrollY()`, Using it with Lenis

### Community 105 - "Scroll Sync"
Cohesion: 0.22
Nodes (8): 1. Why `updateRectEveryFrame: true` is needed, 2. Using it with window scrolling, 3. A single rAF loop with Lenis aligns things even better, Demo, HTML, Notes, Scroll Sync, TypeScript

### Community 106 - "BaseEffectConfig"
Cohesion: 0.25
Nodes (4): Identity, SignedFeedback, FlipYEffect, BaseEffectConfig

### Community 107 - "text-padding.ts"
Cohesion: 0.28
Nodes (7): app, bindPadSlider(), CARDS, CardSpec, planes, refreshAll(), TextStyleOverrides

### Community 108 - "loadFont"
Cohesion: 0.29
Nodes (6): Error handling, `FontFaceSource`, loadFont, Low-level APIs, Separate from `DomTextPlane`, Signature

### Community 109 - "Tetsuya Izumi — Code in motion"
Cohesion: 0.29
Nodes (6): DOMと3つのcanvas, Tetsuya Izumi — Code in motion, シェーダーと負荷, 再生成と検証, 操作とfallback, 確認用URL

### Community 110 - "gpu-regression.ts"
Cohesion: 0.62
Nodes (6): assert(), log(), main(), near(), nextTask(), runBackend()

### Community 112 - "test-portfolio-sync.mjs"
Cohesion: 0.50
Nodes (3): capture(), png(), results

### Community 114 - "Demos"
Cohesion: 0.50
Nodes (3): Catalog, Demos, How to read these demos

### Community 115 - "test-portfolio-production.mjs"
Cohesion: 0.50
Nodes (3): address, errors, report

## Knowledge Gaps
- **382 isolated node(s):** `stage`, `grainOn`, `{ lang }`, `isEn`, `card` (+377 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **31 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DomSyncGL` connect `DomSyncGL` to `constants.ts`, `PointerController`, `DomPlane`, `DomTextPlane.test.ts`, `src/index.ts`, `Core.test.ts`, `ScrollSync`, `EffectManager`, `pause-offscreen.ts`, `.constructor`, `DomPlane.test.ts`, `dom-test.ts`, `DevTools`, `portfolio/main.ts`, `.setPaused`, `sections.ts`, `src/main.ts`, `Dom3DObject`, `PaperCrumple`, `effects-lib.ts`, `process.ts`, `text-padding.ts`, `gpu-regression.ts`?**
  _High betweenness centrality (0.101) - this node is a cross-community bridge._
- **Why does `BaseEffect` connect `BaseEffect` to `DomSyncGL`, `DomPlane`, `src/index.ts`, `BaseEffect.test.ts`, `ditherCursorNodes.ts`, `PixelTrailEffect`, `Core.test.ts`, `BaseEffect.ts`, `PlaneComposer`, `EffectManager.test.ts`, `MouseEffect`, `EffectManager`, `DomPlane.test.ts`, `MouseFlowEffect`, `StateEffect`, `FluidWaterEffect`, `tsl/exhibits.ts`, `WaterRippleEffect`, `SmoothCursorEffect`, `glassCursorNode.ts`, `ripplePostEffect.ts`, `.addEffect`, `RipplePostEffect`, `SplashCursorEffect`, `splashCursorEffect.ts`, `BaseEffectConfig`, `gpu-regression.ts`, `GlassCursorEffect`, `GpuEffect`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Why does `DomPlane` connect `DomPlane` to `DomTextPlane`, `PointerController`, `sections.ts`, `DomSyncGL`, `DomTextPlane.ts`, `src/index.ts`, `Dom3DObject`, `PaperCrumple`, `DomPlane.test.ts`, `StickerPeel`, `DomPositionCalculator`, `PlaneComposer`, `.addEffect`, `BaseEffect`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **What connects `stage`, `grainOn`, `{ lang }` to the rest of the system?**
  _382 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `fluidKernels.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08408163265306122 - nodes in this community are weakly interconnected._
- **Should `graphify build pipeline (Steps 0-9)` be split into smaller, more focused modules?**
  _Cohesion score 0.07317073170731707 - nodes in this community are weakly interconnected._
- **Should `PointerController` be split into smaller, more focused modules?**
  _Cohesion score 0.0946969696969697 - nodes in this community are weakly interconnected._