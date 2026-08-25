/**
 * `@temporalio-web/consent-banner`
 *
 * Framework-neutral cookie-consent banner web component, shared across the
 * temporal.io properties (temporal.io, docs./learn. on Docusaurus, pages. on
 * Marketo). Importing this module is a side effect: it registers the
 * `<temporal-consent-banner>` custom element.
 */
export {
  TemporalConsentBanner,
  ELEMENT_NAME,
  OPEN_EVENT,
} from './element/consent-banner';
export {
  CONSENT_CHANGE_EVENT,
  type ConsentChangeDetail,
} from './element/consent-sync';

// Framework-neutral consent core, shared with consumers so every property reads
// and writes consent through the same types and cookie/regime logic.
export * from './core/consent';
export * from './core/consent-region';
