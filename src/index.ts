// Core classes
export { WebGLApp } from "./Core";
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
  WebGLAppOptions,
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

// Re-export THREE.js for convenience
import * as THREE from "three";
export { THREE };
