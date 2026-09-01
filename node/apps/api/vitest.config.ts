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

    /**
     * Cap the worker pool. This is a MEMORY limit, not a CPU one.
     *
     * Vitest sizes its pool from the core count — 16 here — and every worker
     * running a database suite holds its own PGlite instance, which is a
     * complete PostgreSQL compiled to WASM with its own heap. Sixteen of those,
     * plus argon2id at 19 MiB a hash, exhaust the available memory and the run
     * fails in ways that point nowhere near the cause:
     *
     *     Error: [vitest-worker]: Timeout calling "resolveId"
     *     Error: [vitest-worker]: Timeout calling "onTaskUpdate"
     *     Error: Worker exited unexpectedly
     *
     * The first two are the worker's RPC back to the main thread timing out
     * under memory pressure; the third is the worker being killed outright. They
     * surface as two or three ARBITRARY tests failing, a different set each run,
     * with assertion-shaped output — which is exactly the shape of a flaky test,
     * and re-running does appear to "fix" it. Nothing is flaky. The run is
     * oversubscribed, and it was getting worse with every master added.
     *
     * `pool` is pinned rather than left implicit. Vitest 2's default is "forks",
     * and configuring `poolOptions.threads` — the obvious guess — silently
     * configures a pool that is not in use: the setting is accepted, the run
     * still oversubscribes, and the only evidence is that `ChildProcess` appears
     * in the stack of a pool that is supposed to be threads. Naming the pool
     * means this config cannot miss its target again.
     *
     * Four workers fit comfortably and cost little wall time: these suites are
     * dominated by each test building a database, not by contention for CPU.
     */
    pool: "forks",
    poolOptions: {
      forks: { minForks: 1, maxForks: 4 },
    },
  },
  // esbuild (vitest's default) supports experimentalDecorators but NOT
  // emitDecoratorMetadata, which Nest's DI needs to resolve constructor
  // parameters. swc supplies both.
  plugins: [swc.vite({ module: { type: "es6" } })],
});
