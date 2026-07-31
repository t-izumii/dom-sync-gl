export { DomSyncGL } from "./Core";
export { Camera } from "./Camera";
export { Light } from "./Light";
export { DomPlane } from "./DomPlane";
export { DomTextPlane } from "./DomTextPlane";
export { resolveTextStyle, layoutLines, rasterizeText } from "./TextRasterizer";
export type { ResolvedTextStyle } from "./TextRasterizer";
export { loadFont } from "./FontLoader";
export type { FontFaceSource } from "./FontLoader";
export { Dom3DObject } from "./Dom3DObject";
export { ScrollSync } from "./ScrollSync";
export type { ScrollSyncOptions } from "./ScrollSync";

export { DomPositionCalculator } from "./DomPositionCalculator";
export type { PointerType } from "./PointerController";

export type {
  DomSyncGLOptions,
  CreatePlaneOptions,
  CreateTextPlaneOptions,
  TextStyleOverrides,
  Create3DObjectOptions,
  Dom3DObjectFitMode,
  Offset3D,
  DOMPositionInfo,
  PlaneNodeContext,
} from "./types";

export * from "./constants";

export { BaseScene } from "./scenes/BaseScene";

export { EffectComposer, EffectPass } from "./EffectComposer";
export type {
  EffectOptions,
  EffectTarget,
  EffectLike,
  EffectContext,
} from "./EffectComposer";
export { PlaneComposer } from "./PlaneComposer";
export { BaseEffect } from "./effects/BaseEffect";
export type {
  BaseEffectConfig,
  FeedbackOptions,
  FeedbackNodeContext,
} from "./effects/BaseEffect";

export { FeedbackBuffer } from "./FeedbackBuffer";
export type {
  FeedbackBufferOptions,
  FeedbackInput,
  FeedbackContext,
} from "./FeedbackBuffer";
export type { AddFeedbackOptions } from "./DomPlane";

import * as THREE from "three/webgpu";
export { THREE };
// TSL のノードビルダー（uniform / texture / Fn 等）を利用側が別途 import せずに
// 使えるよう再エクスポートする。
export * as TSL from "three/tsl";
