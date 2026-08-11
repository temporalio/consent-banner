import { describe, test, expect } from 'vitest';
import {
  isConsentRegime,
  isGdprCountry,
  isOptInCountry,
  resolveConsentRegime,
  shouldRepromptOnRegimeChange,
} from './consent-region';

describe('isGdprCountry', () => {
  test.each(['DE', 'FR', 'IT', 'ES', 'PL', 'IE'])(
    'returns true for EU member %s',
    (code) => {
      expect(isGdprCountry(code)).toBe(true);
    },
  );

  test.each(['IS', 'LI', 'NO'])('returns true for EEA member %s', (code) => {
    expect(isGdprCountry(code)).toBe(true);
  });

  test('returns true for the United Kingdom', () => {
    expect(isGdprCountry('GB')).toBe(true);
  });

  test('is case-insensitive', () => {
    expect(isGdprCountry('de')).toBe(true);
    expect(isGdprCountry('gb')).toBe(true);
  });

  test.each(['US', 'CA', 'JP', 'AU', 'BR'])(
    'returns false for non-GDPR country %s',
    (code) => {
      expect(isGdprCountry(code)).toBe(false);
    },
  );

  test('fails safe to true for missing/empty country', () => {
    expect(isGdprCountry(null)).toBe(true);
    expect(isGdprCountry(undefined)).toBe(true);
    expect(isGdprCountry('')).toBe(true);
  });

  test('returns false for an unrecognised present code', () => {
    expect(isGdprCountry('ZZ')).toBe(false);
  });
});

describe('isOptInCountry', () => {
  test.each(['DE', 'FR', 'GB', 'NO'])(
    'returns true for GDPR/EEA/UK country %s',
    (code) => {
      expect(isOptInCountry(code)).toBe(true);
    },
  );

  test.each(['BR', 'CH', 'CA'])(
    'returns true for additional opt-in country %s',
    (code) => {
      expect(isOptInCountry(code)).toBe(true);
    },
  );

  test('is case-insensitive', () => {
    expect(isOptInCountry('br')).toBe(true);
  });

  test.each(['US', 'JP', 'AU'])(
    'returns false for opt-out country %s',
    (code) => {
      expect(isOptInCountry(code)).toBe(false);
    },
  );

  test('fails safe to true for missing country', () => {
    expect(isOptInCountry(null)).toBe(true);
    expect(isOptInCountry('')).toBe(true);
  });
});

describe('resolveConsentRegime', () => {
  test.each(['DE', 'FR', 'GB', 'NO', 'BR', 'CH', 'CA'])(
    'resolves opt_in for opt-in country %s',
    (country) => {
      expect(resolveConsentRegime(country, null)).toBe('opt_in');
    },
  );

  test('Canada (country CA) is opt_in, not confused with California', () => {
    expect(resolveConsentRegime('CA', null)).toBe('opt_in');
  });

  test.each(['CA', 'VA', 'CO', 'CT', 'UT', 'TX', 'OR', 'MT'])(
    'resolves us_opt_out for US opt-out state %s',
    (region) => {
      expect(resolveConsentRegime('US', region)).toBe('us_opt_out');
    },
  );

  test('California region maps to us_opt_out', () => {
    expect(resolveConsentRegime('US', 'CA')).toBe('us_opt_out');
  });

  test.each(['FL', 'NY', 'WA', null, undefined, ''])(
    'resolves us_basic for non-opt-out US region %s',
    (region) => {
      expect(resolveConsentRegime('US', region)).toBe('us_basic');
    },
  );

  test('is case-insensitive for country and region', () => {
    expect(resolveConsentRegime('us', 'ca')).toBe('us_opt_out');
    expect(resolveConsentRegime('de', null)).toBe('opt_in');
  });

  test.each(['JP', 'AU', 'MX', 'IN'])(
    'resolves row for other country %s',
    (country) => {
      expect(resolveConsentRegime(country, null)).toBe('row');
    },
  );

  test('fails safe to opt_in for missing country', () => {
    expect(resolveConsentRegime(null, null)).toBe('opt_in');
    expect(resolveConsentRegime('', 'CA')).toBe('opt_in');
  });
});

describe('shouldRepromptOnRegimeChange', () => {
  test.each([
    ['us_basic', 'us_opt_out'],
    ['row', 'us_opt_out'],
    ['us_basic', 'opt_in'],
    ['row', 'opt_in'],
    ['us_opt_out', 'opt_in'],
  ] as const)(
    're-prompts moving into a stronger regime (%s → %s)',
    (previous, current) => {
      expect(shouldRepromptOnRegimeChange(previous, current)).toBe(true);
    },
  );

  test.each([
    ['opt_in', 'us_opt_out'],
    ['opt_in', 'us_basic'],
    ['opt_in', 'row'],
    ['us_opt_out', 'us_basic'],
    ['us_opt_out', 'row'],
  ] as const)(
    'does not re-prompt moving into a weaker regime (%s → %s)',
    (previous, current) => {
      expect(shouldRepromptOnRegimeChange(previous, current)).toBe(false);
    },
  );

  test.each([
    ['opt_in', 'opt_in'],
    ['us_opt_out', 'us_opt_out'],
    ['us_basic', 'us_basic'],
    ['us_basic', 'row'],
    ['row', 'us_basic'],
  ] as const)(
    'does not re-prompt for an equal-obligation regime (%s → %s)',
    (previous, current) => {
      expect(shouldRepromptOnRegimeChange(previous, current)).toBe(false);
    },
  );

  test.each(['us_opt_out', 'opt_in', 'us_basic', 'row'] as const)(
    'does not re-prompt when the prior regime is unknown (null → %s)',
    (current) => {
      expect(shouldRepromptOnRegimeChange(null, current)).toBe(false);
      expect(shouldRepromptOnRegimeChange(undefined, current)).toBe(false);
    },
  );
});

describe('isConsentRegime', () => {
  test.each(['opt_in', 'us_opt_out', 'us_basic', 'row'] as const)(
    'returns true for the valid regime %s',
    (value) => {
      expect(isConsentRegime(value)).toBe(true);
    },
  );

  test.each([
    'OPT_IN',
    'optin',
    'gdpr',
    'us',
    '',
    'us_opt_in',
    null,
    undefined,
    0,
    1,
    true,
    false,
    {},
    [],
    { regime: 'opt_in' },
  ])('returns false for the invalid value %o', (value) => {
    expect(isConsentRegime(value)).toBe(false);
  });
});
