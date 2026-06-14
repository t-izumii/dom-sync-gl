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
  server: {
    port: 5180,
    open: true,
    // LAN / 実機（スマホ等）からアクセスできるよう全 NIC で listen する（--host 相当）。
    host: true,
  },
  build: {
    // マルチページ: メインサイト
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
      },
    },
  },
});
