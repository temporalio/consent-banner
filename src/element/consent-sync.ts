import { writeConsentCookie, type ConsentRecord } from "../core/consent.js";
import type { ConsentRegime } from "../core/consent-region.js";

/**
 * Consent-change fan-out.
 *
 * A consent decision on temporal.io has to drive five separate channels, and
 * getting any one wrong silently breaks a downstream consumer:
 *
 *  1. `localStorage` — the raw `JSON.stringify`ed value under the same keys the
 *     app's `persistStore` uses (`consent`, `do-not-sell`, `consent-regime`), so
 *     a refresh or a new tab reads the decision, and so the synchronous
 *     Consent-Mode bootstrap in `app.html` can pick it up.
 *  2. `BroadcastChannel('persist-store-<key>')` — the SAME channel `persistStore`
 *     subscribes to. Live consumers (notably the Marketo embed) react to this
 *     WITHOUT re-reading the cookie or reloading; if we only wrote the cookie
 *     they would silently stop updating until a full reload.
 *  3. the `.temporal.io` consent cookie — the SSR-readable mirror of the
 *     decision (see `writeConsentCookie`).
 *  4. Google Consent Mode (`gtag('consent','update', …)`) + a `consent_granted`
 *     dataLayer event so GTM tags react mid-session.
 *  5. a host `temporal:consentchange` window event — the framework-neutral hook a
 *     host uses to re-run consent-dependent work (on temporal.io: `invalidateAll`).
 *
 * This module owns 1, 2, and 4; the element calls `writeConsentCookie` (3) and
 * `dispatchConsentChange` (5) directly around them so ordering is explicit.
 */

type WindowWithDataLayer = Window &
  typeof globalThis & {
    dataLayer?: Record<string, unknown>[];
    gtag?: (...args: unknown[]) => void;
  };

// Long-lived channels, one per key — mirrors persistStore, which keeps a single
// channel open per key. Reusing them (rather than open/postMessage/close) avoids
// any risk of a close() racing an in-flight message.
const channels = new Map<string, BroadcastChannel>();

const channelFor = (key: string): BroadcastChannel | null => {
  try {
    let channel = channels.get(key);
    if (!channel) {
      channel = new BroadcastChannel(`persist-store-${key}`);
      channels.set(key, channel);
    }
    return channel;
  } catch {
    // BroadcastChannel unsupported — degrade to localStorage only.
    return null;
  }
};

/**
 * Persist a value exactly the way `persistStore(key, …, true)` does: write the
 * `JSON.stringify`ed value to localStorage and post the raw value on the
 * matching BroadcastChannel. Both are best-effort — private mode / quota / an
 * unsupported channel must never throw out of a consent action.
 */
export const persistShared = <T>(key: string, value: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode / quota) — non-fatal.
  }
  try {
    channelFor(key)?.postMessage(value);
  } catch {
    // BroadcastChannel post failed (e.g. non-cloneable value / closed channel)
    // — non-fatal.
  }
};

export const persistConsent = (record: ConsentRecord): void =>
  persistShared("consent", record);

export const persistDoNotSell = (doNotSell: boolean): void =>
  persistShared("do-not-sell", doNotSell);

export const persistRegime = (regime: ConsentRegime): void =>
  persistShared("consent-regime", regime);

/**
 * Push Google Consent Mode signals (and the `consent_granted` event) for a
 * consent state. Advertising is only granted when the visitor allowed it AND has
 * not opted out of sale/share. `gtag`/`dataLayer` are optional: on foreign hosts
 * (docs / pages) they may be absent, and that's fine.
 */
export const pushConsentSignals = (record: {
  analytics: boolean;
  advertising: boolean;
  doNotSell: boolean;
}): void => {
  const w = window as WindowWithDataLayer;
  const analyticsState = record.analytics ? "granted" : "denied";
  const adState =
    record.advertising && !record.doNotSell ? "granted" : "denied";

  w.gtag?.("consent", "update", {
    analytics_storage: analyticsState,
    ad_storage: adState,
    ad_user_data: adState,
    ad_personalization: adState,
  });

  if (record.analytics) {
    (w.dataLayer ??= []).push({ event: "consent_granted" });
  }
};

export const CONSENT_CHANGE_EVENT = "temporal:consentchange";

export type ConsentChangeDetail = {
  consent: ConsentRecord;
  doNotSell: boolean;
  regime: ConsentRegime;
};

/**
 * Announce a committed consent change to the host. Fired on `window` (bubbling
 * is irrelevant for a window event) so any framework can listen without a
 * reference to the element. On temporal.io the host listens and calls
 * `invalidateAll` to re-run consent-dependent server loads.
 */
export const dispatchConsentChange = (detail: ConsentChangeDetail): void => {
  window.dispatchEvent(
    new CustomEvent<ConsentChangeDetail>(CONSENT_CHANGE_EVENT, { detail }),
  );
};

export { writeConsentCookie };
