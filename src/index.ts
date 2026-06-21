export { DomSyncGL } from "./Core";
export { Camera } from "./Camera";
export { Light } from "./Light";
export { DomPlane } from "./DomPlane";
export { Dom3DObject } from "./Dom3DObject";
export { ScrollSync } from "./ScrollSync";
export type { ScrollSyncOptions } from "./ScrollSync";
export { RafScroll } from "./RafScroll";
export type { RafScrollOptions } from "./RafScroll";

export { DomPositionCalculator } from "./DomPositionCalculator";

export type {
  DomSyncGLOptions,
  CreatePlaneOptions,
  Create3DObjectOptions,
  Dom3DObjectFitMode,
  Offset3D,
  DOMPositionInfo,
} from "./types";

export * from "./constants";

export { BaseScene } from "./scenes/BaseScene";

export { EffectComposer, EffectPass } from "./EffectComposer";
export type { EffectOptions, EffectTarget, EffectLike } from "./EffectComposer";
export { PlaneComposer } from "./PlaneComposer";
export { BaseEffect } from "./effects/BaseEffect";
export type { BaseEffectConfig } from "./effects/BaseEffect";

export { FeedbackBuffer } from "./FeedbackBuffer";
export type { FeedbackBufferOptions, FeedbackInput } from "./FeedbackBuffer";
export type { AddFeedbackOptions } from "./DomPlane";

import * as THREE from "three";
export { THREE };
