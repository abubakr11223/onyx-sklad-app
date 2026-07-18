import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // next/font/google'ni mock qiladi (layout.tsx modul-darajasida chaqiradi,
    // smoke.test.ts uni import qiladi) — vitest.setup.ts ga qarang.
    setupFiles: ["./vitest.setup.ts"],
  },
});
