import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],

    /**
     * Well above vitest's 5s/10s defaults, deliberately.
     *
     * Most suites here boot a real PostgreSQL per test — PGlite is Postgres
     * compiled to WASM — and then apply every migration to it. That costs a couple
     * of seconds on an idle machine and several more when the suites run in
     * parallel and compete for CPU. With the defaults the failure is a timeout on
     * whichever test lost the race, which reads as a flaky test rather than as a
     * slow one, and re-running "fixes" it. The tests are slow on purpose: running
     * against a real database is what makes the foreign keys and unique indexes
     * mean anything. CI runners are slower than a dev laptop, so leave headroom.
     */
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  // esbuild (vitest's default) supports experimentalDecorators but NOT
  // emitDecoratorMetadata, which Nest's DI needs to resolve constructor
  // parameters. swc supplies both.
  plugins: [swc.vite({ module: { type: "es6" } })],
});
