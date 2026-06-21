import * as THREE from "three";
import { CAMERA_FOV, CAMERA_NEAR, CAMERA_FAR } from "./constants";

export class Camera {
  rect: DOMRect;
  instance: THREE.PerspectiveCamera;

  constructor(rect: DOMRect) {
    this.rect = rect;
    const fovRad = (CAMERA_FOV / 2) * (Math.PI / 180);
    const safeWidth = Math.max(1, rect.width);
    const safeHeight = Math.max(1, rect.height);
    const distance = safeHeight / 2 / Math.tan(fovRad);
    this.instance = new THREE.PerspectiveCamera(
      CAMERA_FOV,
      safeWidth / safeHeight,
      CAMERA_NEAR,
      CAMERA_FAR,
    );
    this.instance.position.z = distance;
  }

  resize(rect: DOMRect) {
    if (rect.width <= 0 || rect.height <= 0) return;

    this.rect = rect;

    const safeWidth = Math.max(1, rect.width);
    const safeHeight = Math.max(1, rect.height);

    const fovRad = (CAMERA_FOV / 2) * (Math.PI / 180);
    const distance = safeHeight / 2 / Math.tan(fovRad);

    this.instance.aspect = safeWidth / safeHeight;
    this.instance.position.z = distance;
    this.instance.updateProjectionMatrix();
  }
}
