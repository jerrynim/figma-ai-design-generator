import path from "path";

import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  envDir: __dirname,
  root: path.resolve(__dirname, "src/ui"),
  plugins: [react(), viteSingleFile(), tsConfigPaths()],
  build: {
    outDir: path.resolve(__dirname, "dist"),
    minify: false, // 모든 최적화 비활성화
    sourcemap: true, // 소스맵 생성으로 디버깅 향상
  },
});
