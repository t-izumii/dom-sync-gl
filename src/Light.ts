import * as THREE from "three";
import {
  AMBIENT_LIGHT_COLOR,
  AMBIENT_LIGHT_INTENSITY,
  DIRECTIONAL_LIGHT_COLOR,
  DIRECTIONAL_LIGHT_INTENSITY,
  DIRECTIONAL_LIGHT_POSITION,
} from "./constants";

export class Light {
  readonly ambientLight: THREE.AmbientLight;
  readonly directionalLight: THREE.DirectionalLight;
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.ambientLight = new THREE.AmbientLight(
      AMBIENT_LIGHT_COLOR,
      AMBIENT_LIGHT_INTENSITY,
    );
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(
      DIRECTIONAL_LIGHT_COLOR,
      DIRECTIONAL_LIGHT_INTENSITY,
    );
    this.directionalLight.position.set(
      DIRECTIONAL_LIGHT_POSITION.x,
      DIRECTIONAL_LIGHT_POSITION.y,
      DIRECTIONAL_LIGHT_POSITION.z,
    );
    this.scene.add(this.directionalLight);
    this.scene.add(this.directionalLight.target);
  }
}
