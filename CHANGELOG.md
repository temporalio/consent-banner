# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/temporalio/consent-banner/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/temporalio/consent-banner/releases/tag/v1.0.0
