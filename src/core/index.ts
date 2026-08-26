/**
 * `@temporalio-web/consent-banner/core`
 *
 * Framework-neutral consent core — types, cookie read/write, and regime
 * resolution — with NO element side effect. Unlike the package root (which
 * registers the `<temporal-consent-banner>` custom element and pulls in Lit),
 * importing this entry is safe from server code, form modules, and any consumer
 * that only needs the shared consent logic.
 */
export * from "./consent.js";
export * from "./consent-region.js";
export * from "./countries.js";
