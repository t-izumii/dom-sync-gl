import * as THREE from "three";
import { CAMERA_FOV, CAMERA_NEAR, CAMERA_FAR } from "./constants";

export class Camera {
  rect: DOMRect;
  /**
   * 内部 THREE.PerspectiveCamera。外部から `lookAt` 等の操作は可能。
   *
   * **注意**: `position.z` は「DOM 1px = WebGL 1unit」を成立させるための値で、
   * `resize()` のたびに `rect.height / 2 / tan(fov/2)` で**上書きされる**。
   * 外から position.z を書き換えても resize で消えるので、ズームや視点調整を
   * 永続化したい場合は別途 update ループで再設定するか、座標系が変わってもよい
   * 設計にすること。
   */
  instance: THREE.PerspectiveCamera;

  constructor(rect: DOMRect) {
    this.rect = rect;
    const fovRad = (CAMERA_FOV / 2) * (Math.PI / 180);
    // container が display:none / レイアウト未確定状態で渡されると 0 になる。
    // height=0 / width=0 で `tan` の除算が無限大、aspect が NaN になり
    // projectionMatrix が壊れて以後復旧不能になるので、最低 1px にクランプ。
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
    // container が display:none やレイアウト未確定のときに 0 が来ると aspect が NaN になり
    // projectionMatrix が壊れるので早期 return。
    if (rect.width <= 0 || rect.height <= 0) return;

    this.rect = rect;

    // constructor と同じく安全側にクランプ（0 が来ない前提だが計算順による微小値で
    // tan の除算が暴れるケースに備える）。
    const safeWidth = Math.max(1, rect.width);
    const safeHeight = Math.max(1, rect.height);

    const fovRad = (CAMERA_FOV / 2) * (Math.PI / 180);
    const distance = safeHeight / 2 / Math.tan(fovRad);

    this.instance.aspect = safeWidth / safeHeight;
    this.instance.position.z = distance;
    this.instance.updateProjectionMatrix();
  }
}
