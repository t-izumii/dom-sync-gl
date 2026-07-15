export const CAMERA_FOV = 60;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 10000;

export const DEFAULT_SCALE = 1;
// 公開 export のため凍結。呼び出し元が誤ってミュートすると、以後生成される
// 全インスタンスの既定値が汚染されるのを防ぐ。
export const DEFAULT_OFFSET = Object.freeze({ x: 0, y: 0, z: 0 });

export const AMBIENT_LIGHT_COLOR = 0xffffff;
export const AMBIENT_LIGHT_INTENSITY = 0.5;
export const DIRECTIONAL_LIGHT_COLOR = 0xffffff;
export const DIRECTIONAL_LIGHT_INTENSITY = 1.0;
export const DIRECTIONAL_LIGHT_POSITION = Object.freeze({ x: 1, y: 1, z: 1 });
