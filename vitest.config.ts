import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/__tests__/**/*.test.ts", "src/**/*.test.ts"],
    // three.webgpu.js が module スコープで参照する WebGPU グローバルを補う
    setupFiles: ["src/__tests__/setup-webgpu-globals.ts"],
    globals: false,
  },
});
