/**
 * Granular cookie-consent state.
 *
 * Categories map onto Google Consent Mode signals:
 * - `necessary`   — strictly necessary cookies. Always on, cannot be disabled
 *                   (ePrivacy Art. 5(3) strictly-necessary exemption).
 * - `analytics`   — analytics / performance cookies → `analytics_storage`.
 * - `advertising` — advertising / marketing cookies → `ad_storage` /
 *                   `ad_user_data` / `ad_personalization`.
 *
 * `decided` records whether the user has made an explicit choice yet; it gates
 * the first-layer notice banner.
 */
export type ConsentCategory = 'analytics' | 'advertising';

export type ConsentRecord = {
  decided: boolean;
  necessary: true;
  analytics: boolean;
  advertising: boolean;
};

export const CONSENT_COOKIE_NAME = 'consent';
const CONSENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/**
 * The default, undecided consent state.
 *
 * In GDPR regions (the default), optional categories start OFF, as required for
 * valid consent — no pre-ticked boxes (CJEU Planet49). In non-GDPR regions an
 * opt-out model applies, so optional categories start ON and the user can
 * withdraw later via the preference center.
 *
 * This factory is the single seam for geography-specific defaults so call sites
 * never need to change.
 */
export const defaultConsent = (isGdprRegion = true): ConsentRecord => ({
  decided: false,
  necessary: true,
  analytics: !isGdprRegion,
  advertising: !isGdprRegion,
});

const isConsentRecord = (value: unknown): value is ConsentRecord => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.decided === 'boolean' &&
    typeof record.analytics === 'boolean' &&
    typeof record.advertising === 'boolean'
  );
};

const readCookieValue = (cookieString: string, key: string): string | null => {
  const parts = cookieString.split(';');

  for (const part of parts) {
    const trimmedPart = part.trim();

    if (!trimmedPart.startsWith(`${key}=`)) {
      continue;
    }

    return decodeURIComponent(trimmedPart.slice(key.length + 1));
  }

  return null;
};

/**
 * Parse a stored consent value into a `ConsentRecord`. Legacy string values
 * ('accepted' / 'rejected') and any malformed data fall through to the
 * undecided default, which re-prompts the user — intended when the consent
 * model changes.
 */
export const parseConsentCookie = (
  rawValue: string | null | undefined,
): ConsentRecord => {
  if (!rawValue) {
    return defaultConsent();
  }

  try {
    const parsed: unknown = JSON.parse(rawValue);

    if (isConsentRecord(parsed)) {
      // `necessary` is always forced on, regardless of the stored value.
      return {
        decided: parsed.decided,
        necessary: true,
        analytics: parsed.analytics,
        advertising: parsed.advertising,
      };
    }
  } catch {
    // Non-JSON (legacy) or corrupted value — fall through to default.
  }

  return defaultConsent();
};

// These report whether a category is CURRENTLY granted — not whether the user
// made an explicit choice. Opt-out regimes (us_opt_out) grant by default while
// keeping `decided: false`, so gating on `decided` here would wrongly report
// those visitors as un-consented even though analytics/advertising are granted
// (and Google Consent Mode is already firing them as granted). Do not re-add a
// `decided` check; read `consent.decided` at a call site if you specifically
// need "the user explicitly chose".
export const hasAnalyticsConsent = (
  consent: ConsentRecord | null | undefined,
): boolean => !!consent?.analytics;

export const hasAdvertisingConsent = (
  consent: ConsentRecord | null | undefined,
): boolean => !!consent?.advertising;

export const readConsentFromCookieString = (
  cookieString: string,
): ConsentRecord => {
  const rawValue = readCookieValue(cookieString, CONSENT_COOKIE_NAME);
  return parseConsentCookie(rawValue);
};

export const readConsentFromDocumentCookie = (): ConsentRecord => {
  if (typeof document === 'undefined') {
    return defaultConsent();
  }

  return readConsentFromCookieString(document.cookie);
};

/**
 * The domain the consent cookie is scoped to.
 *
 * On the temporal.io apex (and any *.temporal.io subdomain) the cookie is
 * written with `Domain=.temporal.io` so the consent decision is shared across
 * every property under the apex (docs / learn / pages, etc.). Elsewhere —
 * localhost and *.vercel.app previews, which are NOT under the apex — no Domain
 * attribute is set and the cookie stays host-only. A Domain the current host
 * doesn't belong to would be rejected by the browser, so this must be gated on
 * the hostname rather than a build-time flag.
 */
const consentCookieDomain = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }

  const hostname = window.location?.hostname ?? '';
  return hostname === 'temporal.io' || hostname.endsWith('.temporal.io')
    ? '.temporal.io'
    : '';
};

export const writeConsentCookie = (consent: ConsentRecord): void => {
  if (typeof document === 'undefined') {
    return;
  }

  const secureFlag = window.location.protocol === 'https:' ? '; Secure' : '';
  const value = encodeURIComponent(JSON.stringify(consent));
  const domain = consentCookieDomain();

  // When scoping to the apex, first expire any legacy HOST-ONLY `consent`
  // cookie (written before this became a domain cookie). Otherwise the browser
  // would hold two `consent` cookies at once — the host-only one and the new
  // `.temporal.io` one — and send both, making server-side reads ambiguous.
  if (domain) {
    document.cookie = `${CONSENT_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax${secureFlag}`;
  }

  const domainAttr = domain ? `; Domain=${domain}` : '';
  document.cookie = `${CONSENT_COOKIE_NAME}=${value}; path=/; max-age=${CONSENT_COOKIE_MAX_AGE}; SameSite=Lax${secureFlag}${domainAttr}`;
};

/**
 * Expire the consent cookie immediately (max-age=0). The cookie is the SSR
 * mirror of the consent decision; on a re-prompt the decision no longer applies,
 * so we clear that mirror. This prevents the stale `decided: true` record from
 * being re-adopted on the next load (see the cookie-adopt step in onMount) and
 * keeps the visitor consistent with any current visitor of the new regime (e.g.
 * us_opt_out normally has no consent cookie). Only the consent decision is
 * cleared — regime, do-not-sell, and session state live in separate stores.
 */
export const clearConsentCookie = (): void => {
  if (typeof document === 'undefined') {
    return;
  }

  // Clear the host-only variant (dev / legacy) and, on the apex, the
  // `.temporal.io` domain variant too. A cookie can only be deleted by a
  // matching Domain attribute, so we expire both to be certain it's gone.
  document.cookie = `${CONSENT_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;

  const domain = consentCookieDomain();
  if (domain) {
    document.cookie = `${CONSENT_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax; Domain=${domain}`;
  }
};
