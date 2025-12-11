import path from "path";

import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  envDir: __dirname,
  root: path.resolve(__dirname, "src"),
  plugins: [viteSingleFile(), tsConfigPaths()],
  build: {
    target: "es2017",
    outDir: path.resolve(__dirname, "dist"),
    rollupOptions: {
      input: path.resolve("src/code.ts"),
      output: {
        entryFileNames: "code.js",
      },
    },
  },
});
