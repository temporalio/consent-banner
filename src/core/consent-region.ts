import type { CountryCode } from './countries';

/**
 * Countries where GDPR (or the materially equivalent UK GDPR) applies and a
 * strict opt-in consent model is required: the EU-27, the wider EEA (Iceland,
 * Liechtenstein, Norway), and the United Kingdom.
 *
 * Typed via `satisfies readonly CountryCode[]` so any code not present in the
 * canonical country roster fails to compile — drift is caught at build time.
 */
const GDPR_COUNTRIES = [
  // EU-27
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
  // EEA (non-EU)
  'IS',
  'LI',
  'NO',
  // UK
  'GB',
] as const satisfies readonly CountryCode[];

const GDPR_COUNTRY_SET: ReadonlySet<string> = new Set(GDPR_COUNTRIES);

/**
 * Whether the given ISO-3166-1 alpha-2 country code falls under a GDPR-style
 * opt-in regime.
 *
 * Fails safe: an absent or empty code (e.g. geolocation unavailable, behind a
 * VPN, or local development) is treated as GDPR so the strictest experience is
 * the default.
 */
export const isGdprCountry = (code: string | null | undefined): boolean => {
  if (!code) {
    return true;
  }

  return GDPR_COUNTRY_SET.has(code.toUpperCase());
};

/**
 * Jurisdictions outside the EU/EEA/UK that nonetheless apply a GDPR-style
 * opt-in consent model: Brazil (LGPD), Switzerland (revFADP), and Canada
 * (PIPEDA / Quebec Law 25). Canada's regime is consent-based but more nuanced
 * than GDPR; it is grouped here as the conservative (strictest) choice. Revisit
 * with legal as these laws evolve.
 */
const ADDITIONAL_OPT_IN_COUNTRIES = [
  'BR',
  'CH',
  'CA',
] as const satisfies readonly CountryCode[];

const OPT_IN_COUNTRY_SET: ReadonlySet<string> = new Set([
  ...GDPR_COUNTRIES,
  ...ADDITIONAL_OPT_IN_COUNTRIES,
]);

/**
 * Whether the given country applies an opt-in consent regime: every GDPR
 * country plus the additional opt-in jurisdictions above.
 *
 * Fails safe: an absent or empty code is treated as opt-in (strictest).
 */
export const isOptInCountry = (code: string | null | undefined): boolean => {
  if (!code) {
    return true;
  }

  return OPT_IN_COUNTRY_SET.has(code.toUpperCase());
};

/**
 * US states with comprehensive consumer-privacy laws granting a right to opt out
 * of the sale/sharing of personal information (and targeted advertising). These
 * receive the "Do Not Sell or Share" experience.
 *
 * ISO 3166-2 subdivision codes without the `US-` prefix, matching Vercel's
 * `x-vercel-ip-country-region` header. This roster changes frequently as new
 * state laws take effect — review periodically with legal.
 */
const US_OPT_OUT_STATES: ReadonlySet<string> = new Set([
  'CA', // California (CCPA/CPRA)
  'VA', // Virginia (VCDPA)
  'CO', // Colorado (CPA)
  'CT', // Connecticut (CTDPA)
  'UT', // Utah (UCPA)
  'TX', // Texas (TDPSA)
  'OR', // Oregon (OCPA)
  'MT', // Montana (MCDPA)
  'IA', // Iowa (ICDPA)
  'DE', // Delaware (DPDPA)
  'NJ', // New Jersey (NJDPA)
  'NH', // New Hampshire (NHPA)
  'NE', // Nebraska (NDPA)
  'MD', // Maryland (MODPA)
  'MN', // Minnesota (MCDPA)
  'TN', // Tennessee (TIPA)
  'IN', // Indiana (INCDPA)
  'KY', // Kentucky (KCDPA)
  'RI', // Rhode Island (RIDTPPA)
]);

/**
 * The consent regime that applies to a visitor, used to pick the right cookie
 * experience:
 * - `opt_in`     — GDPR/EEA/UK plus Brazil/Switzerland/Canada: explicit opt-in,
 *                  all optional categories off, banner required.
 * - `us_opt_out` — US states with opt-out privacy laws: opt-out model with a
 *                  "Do Not Sell or Share" control.
 * - `us_basic`   — other US states: simple notice with Accept/Decline.
 * - `row`        — everywhere else: same simple notice as `us_basic`.
 */
export type ConsentRegime = 'opt_in' | 'us_opt_out' | 'us_basic' | 'row';

/**
 * Runtime guard for `ConsentRegime`. Use when parsing values that TypeScript
 * can only assume the shape of — e.g. a JSON response from `/api/geo`, which
 * a stale cache or proxy could return malformed. Callers should fail safe to
 * `opt_in` (strictest) when this returns false.
 */
export const isConsentRegime = (value: unknown): value is ConsentRegime =>
  value === 'opt_in' ||
  value === 'us_opt_out' ||
  value === 'us_basic' ||
  value === 'row';

/**
 * Resolve a visitor's consent regime from their country and (for the US) region.
 *
 * Fails safe: a missing country resolves to `opt_in` (strictest). The country
 * vs. region split avoids the `CA` collision — `CA` as a country is Canada
 * (opt-in), while `CA` as a US region is California (us_opt_out).
 */
export const resolveConsentRegime = (
  country: string | null | undefined,
  region: string | null | undefined,
): ConsentRegime => {
  if (!country) {
    return 'opt_in';
  }

  const countryCode = country.toUpperCase();

  if (isOptInCountry(countryCode)) {
    return 'opt_in';
  }

  if (countryCode === 'US') {
    const stateCode = region?.toUpperCase();
    return stateCode && US_OPT_OUT_STATES.has(stateCode)
      ? 'us_opt_out'
      : 'us_basic';
  }

  return 'row';
};

/**
 * Relative notice/consent obligation of each regime, used to decide whether a
 * regime change warrants re-prompting. Higher = stronger obligation:
 * - `opt_in`     (2) — mandated affirmative opt-in.
 * - `us_opt_out` (1) — mandated opt-out notice + "Do Not Sell or Share" control.
 * - `us_basic` / `row` (0) — notice-only / silent grant.
 */
const REGIME_OBLIGATION_LEVEL: Record<ConsentRegime, number> = {
  row: 0,
  us_basic: 0,
  us_opt_out: 1,
  opt_in: 2,
};

/**
 * Whether moving from `previous` to `current` regime should re-prompt the
 * visitor. Directional by design: only re-prompt when the new regime carries a
 * STRONGER obligation than the one the prior decision was made under (e.g.
 * `us_basic` → `us_opt_out`, or anything → `opt_in`). Moving to an equal or
 * weaker regime carries the existing decision forward — the footer still exposes
 * the region-appropriate controls. Returns false when `previous` is unknown
 * (legacy decision) since there's nothing to compare against.
 */
export const shouldRepromptOnRegimeChange = (
  previous: ConsentRegime | null | undefined,
  current: ConsentRegime,
): boolean =>
  previous != null &&
  REGIME_OBLIGATION_LEVEL[current] > REGIME_OBLIGATION_LEVEL[previous];
