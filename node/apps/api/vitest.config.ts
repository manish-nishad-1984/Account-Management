import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
  },
  // esbuild (vitest's default) supports experimentalDecorators but NOT
  // emitDecoratorMetadata, which Nest's DI needs to resolve constructor
  // parameters. swc supplies both.
  plugins: [swc.vite({ module: { type: "es6" } })],
});
