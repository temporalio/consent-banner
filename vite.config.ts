import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "TemporalConsentBanner",
      // ESM for bundler/npm consumers (temporal.io, Docusaurus) and a
      // self-contained IIFE for a bare <script> tag (Marketo). Lit is bundled
      // IN (not externalized) so the IIFE needs no import map or bundler.
      formats: ["es", "iife"],
      fileName: (format) => `consent-banner.${format}.js`,
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.ts"],
  },
});
