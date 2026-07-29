import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      // src/ 以下のみ型を出す。__tests__ や vite/vitest config は配布物に入れない。
      // effectsLib はサンプル集で配布対象外（index.ts から import しない限り
      // JS バンドルにも入らない）。型定義も出さない。
      include: ["src"],
      exclude: [
        "src/**/__tests__/**",
        "src/**/*.test.ts",
        "src/effectsLib/**",
      ],
      // index.d.ts を 1 ファイルに統合せず、ファイル構造をそのまま dist に投影する。
      // tree-shake しやすく、ユーザー側で部分 import しても型が引ける。
      rollupTypes: false,
      // tsconfig.json は noEmit:true なので、dts プラグイン用にここで上書き相当の設定を渡す。
      tsconfigPath: "./tsconfig.json",
    }),
  ],
  build: {
    lib: {
      // ESM ネイティブに解決する。__dirname は type:module では存在しないため使わない。
      entry: fileURLToPath(new URL("src/index.ts", import.meta.url)),
      // ESM と CJS の両出力。UMD は不要（モダン bundler 前提）。
      formats: ["es", "cjs"],
      fileName: (format) => (format === "es" ? "index.js" : "index.cjs"),
    },
    rollupOptions: {
      // peerDependencies / dependencies は bundle に含めず、利用側のものを使わせる。
      // three の webgpu/tsl/examples/jsm/* もサブパスごと external 指定する必要がある
      // （正規表現で three の全サブパスをまとめて弾く）。
      // lenis は src では import しておらず example 専用の devDependency。利用側が
      // Lenis 併用する場合に自前導入する前提のため、誤って同梱しないよう外部化だけしておく。
      external: ["three", /^three\/.+/, "lil-gui", "stats.js", "lenis"],
      output: {
        // ESM 出力でも globals は CJS ビルドで利用される。peer 名と揃える。
        globals: {
          three: "THREE",
          "three/webgpu": "THREE",
          "three/tsl": "TSL",
          "lil-gui": "GUI",
          "stats.js": "Stats",
          lenis: "Lenis",
        },
      },
    },
    // ライブラリ用途では小さいファイルでも sourcemap を入れておく（デバッグしやすさ優先）。
    sourcemap: true,
    // 古いブラウザ向けの変換は呼び出し側に任せる。
    target: "es2020",
  },
});
