# @temporalio/cookie-banner

Framework-neutral cookie-consent banner web component **and** consent-regime API
for every `*.temporal.io` property. Deployed at **[consent.temporal.io](https://consent.temporal.io)**.

One source of truth for consent across the Temporal web properties:

- **temporal.io** (SvelteKit) — imports the package and its consent core.
- **docs.temporal.io / learn.temporal.io** (Docusaurus) — load the banner as a `<script>`.
- **pages.temporal.io** (Marketo) — loads the banner as a `<script>`.

The banner renders the region-appropriate notice (GDPR opt-in / US "Do Not
Sell" / plain accept-decline), resolves the visitor's regime from edge
geolocation, and fans a committed decision out to `localStorage`, a
`BroadcastChannel`, the `.temporal.io` cookie, Google Consent Mode, and a
`window` event — so every property reacts to the same decision.

---

## What ships here

| Piece                      | Path           | Purpose                                                                                          |
| -------------------------- | -------------- | ------------------------------------------------------------------------------------------------ |
| `<temporal-cookie-banner>` | `src/element/` | The Lit web component (the visible banner + preference center).                                  |
| Consent core               | `src/core/`    | Framework-neutral consent types, cookie read/write, regime + country logic. **No side effects.** |
| Geo API                    | `api/geo.ts`   | Vercel Edge function that resolves the visitor's consent regime from edge geolocation headers.   |
| Hosted assets              | `vercel.json`  | Versioned `<script>` distribution + the root redirect + cache/CORS headers.                      |

---

## Hosted endpoints (consent.temporal.io)

| Endpoint                       | Behavior                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /`                        | 308 redirect → `https://temporal.io/temporal-cookie-policy`.                                                             |
| `GET /v1/cookie-banner.js`     | The self-contained IIFE bundle (Lit bundled in). `Cache-Control: immutable`, `Access-Control-Allow-Origin: *`.           |
| `GET /v1/cookie-banner.esm.js` | The ESM bundle, same caching/CORS.                                                                                       |
| `GET /api/geo`                 | Per-visitor JSON `{ country, region, regime, gpc }`. CORS scoped to `*.temporal.io`; `Cache-Control: private, no-store`. |

Versioning lives at the **serving layer** (the `/v1/` rewrites in `vercel.json`),
not in the build output — the built files are always `cookie-banner.{es,iife}.js`.

---

## Using it

### 1. Via `<script>` (Docusaurus, Marketo, any host)

The simplest integration — no build tooling, no repo access. Add the tag and the
element to a page:

```html
<script src="https://consent.temporal.io/v1/cookie-banner.js" defer></script>
<temporal-cookie-banner></temporal-cookie-banner>
```

The element self-registers on load and defaults to the canonical policy URL and
geo endpoint, so no attributes are required.

### 2. Via the npm package (temporal.io / any bundler consumer)

The package is published to **GitHub Packages** (private). A consumer needs an
`.npmrc` that maps the `@temporalio` scope and a token with `read:packages`:

```ini
@temporalio:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

`${NODE_AUTH_TOKEN}` is an env reference — nothing secret is committed. On Vercel,
set `NPM_TOKEN` (or `NPM_RC`) in the consuming project so the build can authenticate.

Then install and import the entry point you need:

```ts
// Registers <temporal-cookie-banner> (side-effectful) + re-exports the core.
import "@temporalio/cookie-banner";

// Pure consent core — safe from server code, form modules, anywhere. No element,
// no Lit, no side effects.
import {
  parseConsentCookie,
  resolveConsentRegime,
} from "@temporalio/cookie-banner/core";
```

> The `.` and `./core` entries export **raw TypeScript** (resolved via the
> consumer's `moduleResolution: "Bundler"`). SSR consumers must transpile it —
> e.g. in Vite add `@temporalio/cookie-banner` to `ssr.noExternal`.

---

## Package entry points

| Import                             | Contents                                                                                                                           | Side effects                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `@temporalio/cookie-banner`        | `TemporalCookieBanner`, `ELEMENT_NAME`, `OPEN_EVENT`, `CONSENT_CHANGE_EVENT`, `ConsentChangeDetail`, plus everything from `/core`. | **Yes** — registers the custom element (pulls in Lit). Never route server/form-only imports through this entry. |
| `@temporalio/cookie-banner/core`   | Consent types, cookie read/write, regime + country logic.                                                                          | **None** — server/form safe.                                                                                    |
| `@temporalio/cookie-banner/bundle` | The prebuilt IIFE (`dist/cookie-banner.iife.js`).                                                                                  | Registers the element when loaded.                                                                              |

---

## Configuration

**Attributes:**

| Attribute      | Default                                      | Purpose                                                                                      |
| -------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `policy-url`   | `https://temporal.io/temporal-cookie-policy` | Absolute URL for the "cookie policy" link, so it resolves from any embedding host.           |
| `geo-endpoint` | `https://consent.temporal.io/api/geo`        | Regime resolver. Override to a same-origin route (e.g. `/api/geo`) if the host runs its own. |

**Events (dispatched on `window`, so any framework can listen without a reference):**

| Constant               | Event name                    | Direction                                                                           |
| ---------------------- | ----------------------------- | ----------------------------------------------------------------------------------- |
| `OPEN_EVENT`           | `temporal:cookie-banner-open` | Host → banner: (re)open the notice, e.g. a footer "Cookie preferences" link.        |
| `CONSENT_CHANGE_EVENT` | `temporal:consentchange`      | Banner → host: a decision was committed (`detail: { consent, doNotSell, regime }`). |

**Storage keys** (JSON, mirrored on `BroadcastChannel('persist-store-<key>')`):
`consent`, `do-not-sell`, `consent-regime`.

**Google Consent Mode:** the banner pushes `gtag('consent','update', …)` +
`dataLayer` on decision. `gtag`/`dataLayer` are optional — absent on foreign
hosts is fine.

---

## Consent regimes

| Regime       | Region                        | First-load default                                  |
| ------------ | ----------------------------- | --------------------------------------------------- |
| `opt_in`     | GDPR / EEA / UK               | Deny-by-default (blocks until the visitor chooses). |
| `us_opt_out` | US states with opt-out rights | Granted-by-default, "Do Not Sell" toggle available. |
| `us_basic`   | Other US                      | Granted-by-default.                                 |
| `row`        | Rest of world                 | Granted-by-default.                                 |

`opt_in` is the only regime that blocks before a decision. A stored decision is
reconciled once per session, so a visitor who moves into a stronger-obligation
regime is re-prompted.

---

## Local development

Prerequisites: **Node 22+** and **pnpm**.

```sh
pnpm install
pnpm dev          # vite build --watch
pnpm build        # emit dist/cookie-banner.{es,iife}.js
pnpm test         # vitest run (jsdom)
pnpm test:watch   # vitest watch
pnpm check        # tsc --noEmit
```

### Project structure

```
api/geo.ts              Vercel Edge function: regime resolver + scoped CORS
src/index.ts            Package root — registers the element, re-exports core
src/core/               Framework-neutral consent core (NO side effects)
  consent.ts            Consent record types + cookie read/write
  consent-region.ts     Regime resolution + reprompt logic
  countries.ts          Country/region tables
src/element/            The Lit component + its host-sync layer
  cookie-banner.ts      <temporal-cookie-banner> (renders + orchestrates)
  consent-sync.ts       Fan-out: localStorage / BroadcastChannel / Consent Mode / event
vite.config.ts          Lib build (es + iife) + vitest config
vercel.json             Redirect, /v1 rewrites, immutable cache, CORS
```

### Testing

Tests are colocated as `*.test.ts` and run under vitest with the jsdom
environment. Coverage spans the core logic (`src/core/*.test.ts`) and the element
(behavior, smoke, and a build-output bundle test).

---

## Publishing

The package is published to GitHub Packages by the
[`Publish package`](.github/workflows/publish.yml) workflow, which runs when a
**GitHub Release is published**. Cutting the Release is the deliberate human
step — merging a PR does **not** publish.

1. Bump `version` in `package.json` (npm refuses to republish an existing version).
2. Commit, tag `vX.Y.Z`, and push the tag.
3. Draft a GitHub Release for that tag and publish it.
4. The workflow installs → `check` → `test` → `build` → `pnpm publish` using the
   ephemeral `GITHUB_TOKEN` (no PAT stored).

Manual fallback (from a clean checkout), with a PAT that has `write:packages`:

```sh
NODE_AUTH_TOKEN=<PAT> pnpm publish --no-git-checks
```

The publish target is set by `publishConfig.registry` in `package.json`; `files`
ships both `dist/` and `src/` (the `/core` subpath resolves to raw TS in `src/`).

---

## Deployment

Hosted on Vercel (framework `null`, build `pnpm build`, output `dist/`). `api/geo.ts`
runs on the **Edge runtime** — it reads only the `x-vercel-ip-*` geolocation
headers and does pure computation, so it has the lowest latency and cheapest cold
starts. `vercel.json` owns the root redirect, the `/v1/` rewrites, immutable
caching, and CORS.

Testing overrides (`?country=`, `?region=`, `?gpc=`) and `localhost` CORS are
honored on preview/local deployments but **ignored in production**, where only the
real per-request edge headers are trusted (`VERCEL_ENV === "production"`).

---

## Code style & conventions

- **TypeScript strict**, `moduleResolution: "Bundler"`, `target: ES2022`.
  `useDefineForClassFields: false` (required for Lit reactive class fields).
- **Formatting:** 2-space indent, double quotes, trailing commas.
- **Framework-neutral:** the only runtime dependency is Lit, and only the element
  uses it. `src/core/` has **zero side effects** and no framework imports — keep
  it that way so server and form code can import it freely.
- **Side-effect boundary:** the package root registers the custom element. Never
  route a server-only or form-only import through the root; use `/core`.
- **Best-effort storage:** all `localStorage` / `sessionStorage` /
  `BroadcastChannel` access is wrapped so private mode, quota, or unsupported
  APIs degrade silently — a consent action must never throw out of these.
- **Tests** live next to the code they cover as `*.test.ts`.

## Contributing

1. Branch from `main`, make the change, and add/adjust colocated tests.
2. Run `pnpm check && pnpm test && pnpm build` locally — the publish workflow runs
   the same gates.
3. Open a PR. Merging does not publish; a maintainer cuts a Release when a new
   version is ready.
