import { defineConfig } from "vite";
import { resolve } from "node:path";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      // src/ 以下のみ型を出す。__tests__ や vite/vitest config は配布物に入れない。
      include: ["src"],
      exclude: ["src/**/__tests__/**", "src/**/*.test.ts"],
      // index.d.ts を 1 ファイルに統合せず、ファイル構造をそのまま dist に投影する。
      // tree-shake しやすく、ユーザー側で部分 import しても型が引ける。
      rollupTypes: false,
      // tsconfig.json は noEmit:true なので、dts プラグイン用にここで上書き相当の設定を渡す。
      tsconfigPath: "./tsconfig.json",
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      // ESM と CJS の両出力。UMD は不要（モダン bundler 前提）。
      formats: ["es", "cjs"],
      fileName: (format) => (format === "es" ? "index.js" : "index.cjs"),
    },
    rollupOptions: {
      // peerDependencies は bundle に含めず、利用側のものを使わせる。
      // three の examples/jsm/* もサブパスごと external 指定する必要がある
      // （正規表現で three の全サブパスをまとめて弾く）。
      external: ["three", /^three\/.+/, "lil-gui", "stats.js"],
      output: {
        // ESM 出力でも globals は CJS ビルドで利用される。peer 名と揃える。
        globals: {
          three: "THREE",
          "lil-gui": "GUI",
          "stats.js": "Stats",
        },
      },
    },
    // ライブラリ用途では小さいファイルでも sourcemap を入れておく（デバッグしやすさ優先）。
    sourcemap: true,
    // 古いブラウザ向けの変換は呼び出し側に任せる。
    target: "es2020",
  },
});
