// Core classes
export { DomSyncGL } from "./Core";
export { Camera } from "./Camera";
export { Light } from "./Light";
export { DomPlane } from "./DomPlane";
export { Dom3DObject } from "./Dom3DObject";
export { ScrollSync } from "./ScrollSync";
export type { ScrollSyncOptions } from "./ScrollSync";
export { RafScroll } from "./RafScroll";
export type { RafScrollOptions } from "./RafScroll";

// Utilities
export { DomPositionCalculator } from "./DomPositionCalculator";

// Types
export type {
  DomSyncGLOptions,
  CreatePlaneOptions,
  Create3DObjectOptions,
  Dom3DObjectFitMode,
  Offset3D,
  DOMPositionInfo,
} from "./types";

// Constants
export * from "./constants";

// Scenes
export { BaseScene } from "./scenes/BaseScene";

// Effects framework（具体エフェクトは src/effects/ 側に置く）
export { EffectComposer, EffectPass } from "./EffectComposer";
export type { EffectOptions, EffectTarget, EffectLike } from "./EffectComposer";
export { PlaneComposer } from "./PlaneComposer";
export { BaseEffect } from "./effects/BaseEffect";
export type { BaseEffectConfig } from "./effects/BaseEffect";

// Feedback バッファ（generator / GPGPU: ping-pong で状態を時間蓄積しテクスチャを産む）
export { FeedbackBuffer } from "./FeedbackBuffer";
export type { FeedbackBufferOptions, FeedbackInput } from "./FeedbackBuffer";
export type { AddFeedbackOptions } from "./DomPlane";

// THREE.js の再エクスポート（方針: 利便性を優先して維持する）
//
// 【目的】利用者が `dom-sync-gl` から `THREE` を直接受け取れるようにし、別途 `three` を
// import する手間と、**ライブラリと利用者で three のインスタンス/バージョンが二重化する**
// 事故（`instanceof THREE.Mesh` が false になる等）を避ける。本ライブラリの shader/uniform
// 連携は three 実体の一致が前提なので、単一の three を配るこの形を既定とする。
//
// 【tree-shaking のトレードオフ】`import * as THREE` の名前空間再エクスポートは three 全体を
// 公開 surface に載せる。ただし `package.json` で `sideEffects: false` を宣言済み + ESM ビルド
// （`module` フィールド）なので、**`THREE` を一度も import しない利用者のバンドルには three は
// 含まれない**（named export 単位で drop される）。`THREE` を import した時点で three を引く点は
// namespace 再エクスポートの性質上避けられないが、その場合は利用者がいずれ three を使う前提なので
// 実害は小さい。
//
// 【サイズ最優先の利用者向け】バンドルを最小化したい場合は、この再エクスポートを使わず
// `three` を直接 import する（`import { Mesh } from "three"`）。peerDependencies の three を
// 共有するので二重化も起きない。
import * as THREE from "three";
export { THREE };
