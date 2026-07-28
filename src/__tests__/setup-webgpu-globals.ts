/**
 * vitest の setupFiles で読み込む WebGPU グローバルのポリフィル。
 *
 * three.webgpu.js はモジュールスコープで GPUShaderStage 等のブラウザ組み込み
 * 定数を参照するため、jsdom 環境ではポリフィル無しに import 自体が失敗する。
 * 値は WebGPU 仕様の定数をそのまま定義する（テストでは値の意味は使われない）。
 */

const define = (name: string, value: Record<string, number>): void => {
  if (!(name in globalThis)) {
    Object.defineProperty(globalThis, name, { value, configurable: true });
  }
};

define('GPUShaderStage', { VERTEX: 0x1, FRAGMENT: 0x2, COMPUTE: 0x4 });
define('GPUBufferUsage', {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
});
define('GPUTextureUsage', {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
});
define('GPUMapMode', { READ: 0x1, WRITE: 0x2 });
define('GPUColorWrite', { RED: 0x1, GREEN: 0x2, BLUE: 0x4, ALPHA: 0x8, ALL: 0xf });

export {};
