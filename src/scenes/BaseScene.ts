import * as THREE from "three";
import { Camera } from "../Camera";

export abstract class BaseScene {
  scene: THREE.Scene;
  camera: Camera;

  rect: DOMRect;

  constructor(rect: DOMRect) {
    this.scene = new THREE.Scene();
    this.camera = new Camera(rect);
    this.rect = rect;
  }

  abstract init(): void;
  abstract update(time: number, progress: number): void;

  resize(rect: DOMRect): void {
    this.rect = rect;
    this.camera.resize(rect);
  }

  dispose(): void {}
}
