import * as THREE from "three";
import type { ScrollSyncOptions } from "./ScrollSync";
import type { RafScrollOptions } from "./RafScroll";

export interface Offset3D {
  x: number;
  y: number;
  z: number;
}

export interface DomSyncGLOptions {
  enablePointerTracking?: boolean;
  enableMouseTracking?: boolean;
  scrollSync?: boolean | ScrollSyncOptions;
  rafScroll?: boolean | RafScrollOptions;
  showStats?: boolean;
  statsParent?: HTMLElement;
  outputColorSpace?: THREE.ColorSpace;
  maxPixelRatio?: number;
  showGUI?: boolean;
  guiTitle?: string;
}

export interface CreatePlaneOptions {
  vertexShader?: string;
  fragmentShader?: string;
  uniforms?: { [key: string]: THREE.IUniform };
  updateRectEveryFrame?: boolean;
  segments?: number;
  onInView?: (plane: import('./DomPlane').DomPlane) => void;
  onOutView?: (plane: import('./DomPlane').DomPlane) => void;
  inViewRootMargin?: string;
  inViewRepeat?: boolean;
  crossOrigin?: string;
}

export type Dom3DObjectFitMode = "maxSide" | "contain" | "cover";

export interface Create3DObjectOptions {
  modelPath: string;
  scale?: number;
  offset?: Offset3D;
  updateRectEveryFrame?: boolean;
  fitMode?: Dom3DObjectFitMode;
}

export interface DOMPositionInfo {
  pageTop: number;
  pageLeft: number;
  isFixed: boolean;
}
