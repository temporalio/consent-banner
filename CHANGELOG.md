# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.2]

### Fixed

- Emit the `consent_granted` dataLayer event only when analytics consent actually
  transitions to granted, instead of on every consent re-apply. The Google
  Consent Mode update is idempotent and still runs on every call, but the
  non-idempotent `consent_granted` event was re-pushed whenever the default grant
  was re-applied or a decision was re-affirmed, causing GTM to double-fire every
  consent-gated tag. The most visible case was `us_opt_out` visitors — whose
  undecided default grant is re-applied on every page load — double-counting page
  views from the second view on (surfaced by Reo.dev); the same gate also covers
  re-affirmations in other regimes (e.g. accepting an already-granted notice).

## [1.0.0]

Initial public release on npm as `@temporalio-web/consent-banner`, published with
provenance via OIDC trusted publishing.

Supersedes the internal, GitHub Packages-only `@temporalio/cookie-banner@1.0.0`.
The package, custom element, and CDN artifacts were renamed to `consent-banner`
(element tag `<temporal-consent-banner>`); the public entry points and behavior
are otherwise unchanged.

### Added

- `<temporal-consent-banner>` framework-neutral Lit consent-banner web component.
- `.` (element + core), `./core` (side-effect-free consent logic), and `./bundle`
  (self-contained IIFE) entry points, shipped as compiled ESM with type
  declarations.
- Consent-regime resolution (`opt_in` / `us_opt_out` / `us_basic` / `row`), GPC
  handling, and Google Consent Mode signal fan-out.

[Unreleased]: https://github.com/temporalio/consent-banner/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/temporalio/consent-banner/compare/v1.0.0...v1.0.2
[1.0.0]: https://github.com/temporalio/consent-banner/releases/tag/v1.0.0
