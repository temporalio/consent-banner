// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONSENT_CHANGE_EVENT,
  dispatchConsentChange,
  persistConsent,
  pushConsentSignals,
  type ConsentChangeDetail,
} from './consent-sync';
import type { ConsentRecord } from '../core/consent';

const decided: ConsentRecord = {
  decided: true,
  necessary: true,
  analytics: true,
  advertising: false,
};

// Resolve with the first message posted on persistStore's channel for `key`.
// The listener is a SEPARATE BroadcastChannel instance, so it receives the
// module's post (a channel never receives its own messages).
const nextBroadcast = <T>(key: string): Promise<T> =>
  new Promise((resolve) => {
    const channel = new BroadcastChannel(`persist-store-${key}`);
    channel.addEventListener('message', (event) => {
      resolve(event.data as T);
      channel.close();
    });
  });

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// Regression guard for the "BroadcastChannel trap": live consumers (the Marketo
// embed) react to consent via BroadcastChannel, NOT the cookie. If the banner
// only wrote localStorage/cookie, they would silently stop updating. Every
// commit MUST both write localStorage AND post on the persistStore channel.
describe('persistConsent fan-out', () => {
  it('writes localStorage in persistStore format', () => {
    persistConsent(decided);
    expect(JSON.parse(localStorage.getItem('consent') ?? 'null')).toEqual(
      decided,
    );
  });

  it('broadcasts on the persist-store-consent channel', async () => {
    const received = nextBroadcast<ConsentRecord>('consent');
    persistConsent(decided);
    await expect(received).resolves.toEqual(decided);
  });
});

describe('pushConsentSignals', () => {
  it('grants analytics but denies ads when do-not-sell is on', () => {
    const gtag = vi.fn();
    (window as unknown as { gtag: unknown }).gtag = gtag;
    (window as unknown as { dataLayer: unknown[] }).dataLayer = [];

    pushConsentSignals({ analytics: true, advertising: true, doNotSell: true });

    expect(gtag).toHaveBeenCalledWith('consent', 'update', {
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
    expect(
      (window as unknown as { dataLayer: unknown[] }).dataLayer,
    ).toContainEqual({ event: 'consent_granted' });
  });

  it('denies everything and pushes no event when all categories are off', () => {
    const gtag = vi.fn();
    (window as unknown as { gtag: unknown }).gtag = gtag;
    (window as unknown as { dataLayer: unknown[] }).dataLayer = [];

    pushConsentSignals({
      analytics: false,
      advertising: false,
      doNotSell: false,
    });

    expect(gtag).toHaveBeenCalledWith('consent', 'update', {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
    expect(
      (window as unknown as { dataLayer: unknown[] }).dataLayer,
    ).toHaveLength(0);
  });

  it('does not throw when gtag/dataLayer are absent (foreign host)', () => {
    delete (window as unknown as { gtag?: unknown }).gtag;
    delete (window as unknown as { dataLayer?: unknown }).dataLayer;
    expect(() =>
      pushConsentSignals({
        analytics: true,
        advertising: true,
        doNotSell: false,
      }),
    ).not.toThrow();
  });
});

describe('dispatchConsentChange', () => {
  it('fires a consent-change window event carrying the decision', () => {
    const handler = vi.fn();
    window.addEventListener(CONSENT_CHANGE_EVENT, handler);

    const detail: ConsentChangeDetail = {
      consent: decided,
      doNotSell: false,
      regime: 'opt_in',
    };
    dispatchConsentChange(detail);

    window.removeEventListener(CONSENT_CHANGE_EVENT, handler);
    expect(handler).toHaveBeenCalledOnce();
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual(detail);
  });
});
