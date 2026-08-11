// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  defaultConsent,
  parseConsentCookie,
  hasAnalyticsConsent,
  hasAdvertisingConsent,
  readConsentFromCookieString,
  writeConsentCookie,
  CONSENT_COOKIE_NAME,
  type ConsentRecord,
} from './consent';

const decided = (overrides: Partial<ConsentRecord> = {}): ConsentRecord => ({
  decided: true,
  necessary: true,
  analytics: false,
  advertising: false,
  ...overrides,
});

describe('defaultConsent', () => {
  test('is undecided with necessary on and optional categories off', () => {
    expect(defaultConsent()).toEqual({
      decided: false,
      necessary: true,
      analytics: false,
      advertising: false,
    });
  });

  test('defaults optional categories off for GDPR regions', () => {
    expect(defaultConsent(true)).toEqual({
      decided: false,
      necessary: true,
      analytics: false,
      advertising: false,
    });
  });

  test('defaults optional categories on (opt-out) for non-GDPR regions', () => {
    expect(defaultConsent(false)).toEqual({
      decided: false,
      necessary: true,
      analytics: true,
      advertising: true,
    });
  });

  test('returns a fresh object each call', () => {
    expect(defaultConsent()).not.toBe(defaultConsent());
  });
});

describe('parseConsentCookie', () => {
  test('round-trips a valid granular record', () => {
    const record = decided({ analytics: true, advertising: true });
    expect(parseConsentCookie(JSON.stringify(record))).toEqual(record);
  });

  test('forces necessary to true regardless of stored value', () => {
    const stored = {
      decided: true,
      necessary: false,
      analytics: true,
      advertising: false,
    };
    expect(parseConsentCookie(JSON.stringify(stored)).necessary).toBe(true);
  });

  test('returns undecided default for legacy "accepted" string', () => {
    expect(parseConsentCookie('accepted')).toEqual(defaultConsent());
  });

  test('returns undecided default for legacy "rejected" string', () => {
    expect(parseConsentCookie('rejected')).toEqual(defaultConsent());
  });

  test('returns undecided default for malformed JSON', () => {
    expect(parseConsentCookie('{not json')).toEqual(defaultConsent());
  });

  test('returns undecided default for JSON missing required fields', () => {
    expect(parseConsentCookie(JSON.stringify({ decided: true }))).toEqual(
      defaultConsent(),
    );
  });

  test('returns undecided default for null/undefined/empty', () => {
    expect(parseConsentCookie(null)).toEqual(defaultConsent());
    expect(parseConsentCookie(undefined)).toEqual(defaultConsent());
    expect(parseConsentCookie('')).toEqual(defaultConsent());
  });
});

describe('hasAnalyticsConsent', () => {
  test('returns true when analytics granted after an explicit decision', () => {
    expect(hasAnalyticsConsent(decided({ analytics: true }))).toBe(true);
  });

  test('returns true when analytics granted by default (not yet decided)', () => {
    expect(
      hasAnalyticsConsent(decided({ decided: false, analytics: true })),
    ).toBe(true);
  });

  test('returns false when analytics denied', () => {
    expect(hasAnalyticsConsent(decided({ analytics: false }))).toBe(false);
  });

  test('returns false for null/undefined', () => {
    expect(hasAnalyticsConsent(null)).toBe(false);
    expect(hasAnalyticsConsent(undefined)).toBe(false);
  });
});

describe('hasAdvertisingConsent', () => {
  test('returns true when advertising granted after an explicit decision', () => {
    expect(hasAdvertisingConsent(decided({ advertising: true }))).toBe(true);
  });

  test('returns true when advertising granted by default (not yet decided)', () => {
    expect(
      hasAdvertisingConsent(decided({ decided: false, advertising: true })),
    ).toBe(true);
  });

  test('returns false when advertising denied', () => {
    expect(hasAdvertisingConsent(decided({ advertising: false }))).toBe(false);
  });

  test('returns false for null/undefined', () => {
    expect(hasAdvertisingConsent(null)).toBe(false);
    expect(hasAdvertisingConsent(undefined)).toBe(false);
  });
});

describe('readConsentFromCookieString', () => {
  test('reads consent cookie when it is the only cookie', () => {
    const record = decided({ analytics: true });
    const value = encodeURIComponent(JSON.stringify(record));
    expect(readConsentFromCookieString(`consent=${value}`)).toEqual(record);
  });

  test('reads consent cookie from a multi-cookie string', () => {
    const record = decided({ advertising: true });
    const value = encodeURIComponent(JSON.stringify(record));
    expect(
      readConsentFromCookieString(`foo=bar; consent=${value}; baz=qux`),
    ).toEqual(record);
  });

  test('returns undecided default when consent cookie is absent', () => {
    expect(readConsentFromCookieString('foo=bar; baz=qux')).toEqual(
      defaultConsent(),
    );
  });

  test('returns undecided default for empty cookie string', () => {
    expect(readConsentFromCookieString('')).toEqual(defaultConsent());
  });

  test('does not match a cookie whose name contains "consent" as a suffix', () => {
    const value = encodeURIComponent(JSON.stringify(decided()));
    expect(readConsentFromCookieString(`noconsent=${value}`)).toEqual(
      defaultConsent(),
    );
  });
});

describe('writeConsentCookie', () => {
  const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');

  // Define window.location as configurable + writable so it can be reset per
  // test and restored afterwards, instead of leaking a mocked location.
  const setLocation = (protocol: string, hostname: string): void => {
    Object.defineProperty(window, 'location', {
      value: { protocol, hostname },
      configurable: true,
      writable: true,
    });
  };

  beforeEach(() => {
    // Reset document.cookie via a writable mock
    let cookieStore = '';
    vi.spyOn(document, 'cookie', 'set').mockImplementation((value: string) => {
      cookieStore = value;
    });
    vi.spyOn(document, 'cookie', 'get').mockImplementation(() => cookieStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalLocation) {
      Object.defineProperty(window, 'location', originalLocation);
    }
  });

  test('writes a record that round-trips through readConsentFromCookieString', () => {
    setLocation('https:', 'temporal.io');
    const record = decided({ analytics: true, advertising: true });
    writeConsentCookie(record);
    expect(readConsentFromCookieString(document.cookie)).toEqual(record);
  });

  test('writes consent cookie with SameSite=Lax', () => {
    setLocation('https:', 'temporal.io');
    writeConsentCookie(decided());
    expect(document.cookie).toContain(`${CONSENT_COOKIE_NAME}=`);
    expect(document.cookie).toContain('SameSite=Lax');
  });

  test('includes Secure flag on https', () => {
    setLocation('https:', 'temporal.io');
    writeConsentCookie(decided());
    expect(document.cookie).toContain('Secure');
  });

  test('omits Secure flag on http', () => {
    setLocation('http:', 'temporal.io');
    writeConsentCookie(decided());
    expect(document.cookie).not.toContain('Secure');
  });

  test('scopes the cookie to .temporal.io on the apex', () => {
    setLocation('https:', 'temporal.io');
    writeConsentCookie(decided());
    expect(document.cookie).toContain('Domain=.temporal.io');
  });

  test('scopes the cookie to .temporal.io on a subdomain', () => {
    setLocation('https:', 'docs.temporal.io');
    writeConsentCookie(decided());
    expect(document.cookie).toContain('Domain=.temporal.io');
  });

  test('omits Domain off the apex (localhost / preview)', () => {
    setLocation('https:', 'website-redux.vercel.app');
    writeConsentCookie(decided());
    expect(document.cookie).not.toContain('Domain=');
  });
});
