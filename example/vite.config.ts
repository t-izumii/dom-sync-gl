import { defineConfig } from "vite";
import { resolve } from "node:path";

// example/ を root にした単独の vite アプリ。
// dom-sync-gl は publish 済みパッケージではなく、リポジトリ直下の src を直接 alias して
// 参照する（ライブラリのソースを編集しながらサンプルで動作確認できる）。
export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      "dom-sync-gl": resolve(__dirname, "../src/index.ts"),
    },
  },
  build: {
    // マルチページ build。デフォルトは root の index.html だけなので、
    // 追加テストページ（dom-test / effects-lib）も入口として明示する。
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        "dom-test": resolve(__dirname, "dom-test.html"),
        "pause-offscreen": resolve(__dirname, "pause-offscreen.html"),
        "effects-lib": resolve(__dirname, "effects-lib.html"),
      },
    },
  },
  server: {
    port: 5180,
    open: true,
    // LAN / 実機（スマホ等）からアクセスできるよう全 NIC で listen する（--host 相当）。
    host: true,
  },
});
