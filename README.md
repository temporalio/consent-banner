# @temporalio-web/consent-banner

A framework-neutral consent-banner web component for Temporal's public web
properties. It renders the cookie/consent UI, resolves the applicable consent
regime (`opt_in` / `us_opt_out` / `us_basic` / `row`), honors Global Privacy
Control, persists the user's choice, and fans the result out as Google Consent
Mode signals.

Built with [Lit](https://lit.dev). Ships as compiled ESM with type declarations,
plus a self-contained bundle for drop-in `<script>` usage.

## What's in the box

| Thing                       | Where          | Purpose                                                                  |
| --------------------------- | -------------- | ------------------------------------------------------------------------ |
| `<temporal-consent-banner>` | `src/element/` | The custom element (UI + wiring).                                        |
| Consent core                | `src/core/`    | Framework-free regime logic, storage, and Consent Mode — no DOM, no Lit. |
| IIFE bundle                 | build output   | Self-contained artifact for CDN `<script src>` usage.                    |

## Using it

### Drop-in `<script>` (any site)

```html
<script src="https://<cdn-host>/v1/consent-banner.js" defer></script>
<temporal-consent-banner></temporal-consent-banner>
```

The IIFE bundle registers the element and includes Lit — no build step required.

### As an npm dependency (bundler / framework)

This package is published to the **public npm registry** — no auth or `.npmrc`
scope config is required.

```sh
pnpm add @temporalio-web/consent-banner
```

Register the element (side-effectful — defines the custom element):

```ts
import "@temporalio-web/consent-banner";
```

```html
<temporal-consent-banner></temporal-consent-banner>
```

Or use the framework-free consent logic without the element or Lit:

```ts
import { resolveConsentRegime } from "@temporalio-web/consent-banner/core";
```

The package ships compiled ESM + `.d.ts` — consumers need no extra transpile
step. Because the element calls `customElements.define`, register it on the
client in SSR frameworks. The `./core` entry is DOM-free and safe on the server.

## Package entry points

| Import                                  | Contents                                       | Side effects                          |
| --------------------------------------- | ---------------------------------------------- | ------------------------------------- |
| `@temporalio-web/consent-banner`        | `TemporalConsentBanner` element + core exports | Registers `<temporal-consent-banner>` |
| `@temporalio-web/consent-banner/core`   | Regime logic, storage, Consent Mode            | None (safe on the server)             |
| `@temporalio-web/consent-banner/bundle` | Prebuilt IIFE (Lit bundled)                    | Registers the element                 |

## Hosted endpoints

| Endpoint                        | Serves                                 |
| ------------------------------- | -------------------------------------- |
| `GET /v1/consent-banner.js`     | IIFE bundle (`consent-banner.iife.js`) |
| `GET /v1/consent-banner.esm.js` | ESM bundle (`consent-banner.es.js`)    |

Rewrites live in `vercel.json`. The `/v1/` prefix is the stable public contract;
build output filenames are always `consent-banner.{es,iife}.js`.

## Events

| Event                          | Direction | Meaning                                                                       |
| ------------------------------ | --------- | ----------------------------------------------------------------------------- |
| `temporal:consent-banner-open` | in        | Dispatch on `window` to reopen the banner (e.g. a "Cookie preferences" link). |

## Local development

```sh
pnpm install
pnpm dev        # Vite dev server
pnpm check      # type-check
pnpm test       # unit + behavior + bundle tests
pnpm build      # emit dist/ (compiled ESM + types + consent-banner.{es,iife}.js)
```

## Project structure

```
src/
  index.ts                        public entry (element + core re-exports)
  element/
    consent-banner.ts             <temporal-consent-banner> (TemporalConsentBanner)
  core/                           framework-free consent logic
vercel.json                       /v1/ CDN rewrites
vite.config.ts                    bundle build (Lit bundled)
tsconfig.build.json               compiled ESM + .d.ts emit (Lit external)
```

## Publishing

Published to the public npm registry via **OIDC trusted publishing** — no npm
token is stored anywhere. Provenance is generated automatically.

Prerequisites (one-time, on npmjs.com): a trusted publisher is configured for
`@temporalio-web/consent-banner` pointing at org `temporalio`, repository
`consent-banner`, workflow `publish.yml`. The repo must be public and
`repository.url` in `package.json` must match the GitHub repo.

To cut a release:

1. Bump `version` in `package.json` and update `CHANGELOG.md`.
2. Tag it: `git tag vX.Y.Z && git push --tags`.
3. Draft a GitHub Release for that tag.

Publishing the Release triggers `.github/workflows/publish.yml`, which builds,
tests, and runs `npm publish` under OIDC — attaching a provenance attestation.
npm refuses to republish an existing version, so the version bump gates every
publish. Merging a PR does **not** publish; a maintainer cuts a Release when a
new version is ready.
