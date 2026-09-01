import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

/**
 * Workspace packages resolve to their TypeScript SOURCE, not their built dist.
 * They are compiled to CommonJS for the NestJS API, which Rollup cannot
 * named-import from.
 */
const workspaceSrc = (pkg: string) =>
  fileURLToPath(new URL(`../../packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@accountmanagement/contracts": workspaceSrc("contracts"),
      "@accountmanagement/domain": workspaceSrc("domain"),
    },
  },
  server: {
    port: 5180,
    proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: true } },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
