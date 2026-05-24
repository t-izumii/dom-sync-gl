// カメラ設定
export const CAMERA_FOV = 60;
export const CAMERA_NEAR = 0.1;
/**
 * Camera の far plane。座標系は「DOM 1px = WebGL 1unit」。
 * カメラ距離は `viewport高 / 2 / tan(fov/2)` で ~519px (viewport=600px) 前後になるため
 * far=10000 はかなり余裕がある（カメラ距離の ~20 倍）。
 *
 * **注意**: near=0.1 / far=10000 で精度レンジが 5 桁開いており、z 軸を奥行きに
 * 積極的に使うと z-fighting / shadow map の精度劣化が出やすい。
 * 奥行き表現を多用する場合は near/far をユースケースに合わせて絞ること。
 */
export const CAMERA_FAR = 10000;

// デフォルト値
export const DEFAULT_SCALE = 1;
export const DEFAULT_OFFSET = { x: 0, y: 0, z: 0 };

// ライト設定
export const AMBIENT_LIGHT_COLOR = 0xffffff;
export const AMBIENT_LIGHT_INTENSITY = 0.5;
export const DIRECTIONAL_LIGHT_COLOR = 0xffffff;
export const DIRECTIONAL_LIGHT_INTENSITY = 1.0;
export const DIRECTIONAL_LIGHT_POSITION = { x: 1, y: 1, z: 1 };
