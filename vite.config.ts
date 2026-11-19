import { defineConfig, type Plugin } from "vitest/config";
import { resolveConsentRegime } from "./src/core/consent-region";

// Dev-only stub for the geolocation endpoint the element calls. It mirrors
// api/geo.ts in non-production: the regime is resolved from `country`/`region`
// query params (which the element forwards), with a `gpc` override, so the demo
// page can exercise every regime via e.g. `?country=US&region=CA&gpc=1`. With no
// params it falls back to the strict `opt_in` regime. The hook only runs under
// the dev server, so it is inert in builds.
const geoStub = (): Plugin => ({
  name: "consent-banner-geo-stub",
  configureServer(server) {
    server.middlewares.use("/api/geo", (req, res) => {
      const url = new URL(req.url ?? "", "http://localhost");
      const country = url.searchParams.get("country");
      const region = url.searchParams.get("region");
      const gpcParam = url.searchParams.get("gpc");
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          country,
          region,
          regime: resolveConsentRegime(country, region),
          gpc: gpcParam === "1" || gpcParam === "true",
        }),
      );
    });
  },
});

export default defineConfig({
  plugins: [geoStub()],
  build: {
    // tsc (tsconfig.build.json) emits the ESM + .d.ts into dist/ first; this
    // vite pass adds the CDN/bundle files, so it must not wipe dist/.
    emptyOutDir: false,
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
