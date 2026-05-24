import * as THREE from "three";
import {
  AMBIENT_LIGHT_COLOR,
  AMBIENT_LIGHT_INTENSITY,
  DIRECTIONAL_LIGHT_COLOR,
  DIRECTIONAL_LIGHT_INTENSITY,
  DIRECTIONAL_LIGHT_POSITION,
} from "./constants";

/**
 * シンプルな環境光 + 平行光の組み合わせを scene に追加するクラス。
 *
 * **制約**:
 * - shadow（影）は無効。`castShadow` / `receiveShadow` を有効化したい場合は
 *   `directionalLight.castShadow = true` を外から設定し、別途 shadow map 設定が必要。
 *
 * 簡易ライティングで十分なケースを想定。複雑なライト設計が必要なら、
 * `WebGLApp.getLight()` から内部 light を取り出して直接操作するか、
 * `WebGLApp.getScene()` に独自ライトを追加する。
 */
export class Light {
  readonly ambientLight: THREE.AmbientLight;
  readonly directionalLight: THREE.DirectionalLight;
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // 環境光
    this.ambientLight = new THREE.AmbientLight(
      AMBIENT_LIGHT_COLOR,
      AMBIENT_LIGHT_INTENSITY,
    );
    this.scene.add(this.ambientLight);

    // 平行光源
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
    // `directionalLight.target` を scene に add しておかないと、外部から
    // `target.position` を動かしても更新が反映されない (three.js の仕様)。
    // 既定は scene 原点を向くが、利用側で動的に向きを変えられるよう add しておく。
    this.scene.add(this.directionalLight.target);
  }
}
