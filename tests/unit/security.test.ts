import { describe, expect, it, vi } from 'vitest';

import { escapeCsvValue, toCsv } from '@/lib/export';
import { redact } from '@/lib/logger';
import {
  DEFAULT_PASSWORD_MIN_LENGTH,
  checkPasswordPolicy,
  evaluatePassword,
  isPasswordAcceptable,
  passwordStrength,
} from '@/lib/auth/password-policy';
import { coerceSettingValue, SETTINGS_BY_KEY } from '@/lib/settings-registry';

/**
 * Security-adjacent pure logic: password policy, log redaction and CSV
 * escaping. Each of these has a failure mode that is silent and harmful --
 * a weak password accepted, a secret written to a log, or a spreadsheet that
 * executes a formula on a colleague's machine.
 *
 * Also covers the CSRF origin check, whose test is here because it is pure
 * synchronous logic (no DB, no cookies).
 */

// ---------------------------------------------------------------------------
// CSRF origin check
// ---------------------------------------------------------------------------

vi.mock('@/lib/env', () => ({
  serverEnv: { APP_URL: 'http://localhost:3000', NODE_ENV: 'development' },
  isProduction: false,
  isDevelopment: true,
  isTest: false,
  publicConfig: { appUrl: 'http://localhost:3000', entraEnabled: false, passwordMinLength: 12 },
  entraAllowedDomains: () => [],
}));

// Import after the mock is in place.
const { assertSameOrigin } = await import('@/lib/csrf');

/** Build a minimal Request with the given headers and method. */
const req = (
  method: string,
  headers: Record<string, string>,
): Request =>
  new Request('http://localhost:3000/api/test', { method, headers });

describe('assertSameOrigin', () => {
  it('passes GET requests without any check', () => {
    expect(() => assertSameOrigin(req('GET', {}))).not.toThrow();
    expect(() => assertSameOrigin(req('HEAD', {}))).not.toThrow();
  });

  it('allows a POST whose Origin matches APP_URL', () => {
    expect(() =>
      assertSameOrigin(req('POST', { origin: 'http://localhost:3000' })),
    ).not.toThrow();
  });

  it('allows a POST whose Origin matches the Host header (port-shift scenario)', () => {
    // Next.js is serving on 3002 but APP_URL still says 3000. The Host header
    // tells us which port the server is actually on; the Origin must match it.
    expect(() =>
      assertSameOrigin(
        req('POST', { origin: 'http://localhost:3002', host: 'localhost:3002' }),
      ),
    ).not.toThrow();
  });

  it('allows a POST whose Referer origin matches APP_URL (no Origin header)', () => {
    expect(() =>
      assertSameOrigin(
        req('POST', { referer: 'http://localhost:3000/login' }),
      ),
    ).not.toThrow();
  });

  it('rejects a POST with no Origin and no Referer', () => {
    expect(() => assertSameOrigin(req('POST', {}))).toThrow('missing its origin');
  });

  it('rejects a POST whose Origin is a different host', () => {
    expect(() =>
      assertSameOrigin(req('POST', { origin: 'http://evil.example.com' })),
    ).toThrow('unrecognised origin');
  });

  it('rejects a POST whose Origin is a different port with no matching Host', () => {
    // Origin is 3002 but APP_URL is 3000 and Host says 3000 — mismatch.
    expect(() =>
      assertSameOrigin(
        req('POST', { origin: 'http://localhost:3002', host: 'localhost:3000' }),
      ),
    ).toThrow('unrecognised origin');
  });

  it('rejects PUT, PATCH and DELETE from an unrecognised origin', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      expect(() =>
        assertSameOrigin(req(method, { origin: 'http://evil.example.com' })),
      ).toThrow('unrecognised origin');
    }
  });
});

describe('password policy', () => {
  it('accepts a strong password', () => {
    expect(isPasswordAcceptable('Corr3ct-Horse!Battery')).toBe(true);
    expect(checkPasswordPolicy('Corr3ct-Horse!Battery')).toEqual([]);
  });

  it('rejects a password that is too short', () => {
    const issues = checkPasswordPolicy('Ab3!xyz');
    expect(issues.some((issue) => issue.includes('12 characters'))).toBe(true);
  });

  it('requires each character class', () => {
    expect(checkPasswordPolicy('alllowercase!1')).toContain('An upper-case letter');
    expect(checkPasswordPolicy('ALLUPPERCASE!1')).toContain('A lower-case letter');
    expect(checkPasswordPolicy('NoDigitsHere!!')).toContain('A number');
    expect(checkPasswordPolicy('NoSymbolsHere1')).toContain('A symbol');
  });

  it('rejects a long but commonly used password', () => {
    expect(isPasswordAcceptable('welcome12345')).toBe(false);
    expect(checkPasswordPolicy('welcome12345')).toContain('Not a commonly used password');
  });

  it('rejects a single repeated character however long', () => {
    expect(isPasswordAcceptable('aaaaaaaaaaaaaaaaaaaa')).toBe(false);
  });

  it('rejects a password built from the account details', () => {
    const context = {
      email: 'amara.okonkwo@example.com',
      firstName: 'Amara',
      lastName: 'Okonkwo',
    };

    expect(
      checkPasswordPolicy('Amara-Secret-99!', DEFAULT_PASSWORD_MIN_LENGTH, context),
    ).toContain('Does not contain your name or email');

    expect(
      checkPasswordPolicy('Okonkwo!2026xyz', DEFAULT_PASSWORD_MIN_LENGTH, context),
    ).toContain('Does not contain your name or email');

    // Unrelated password with the same context is fine.
    expect(
      isPasswordAcceptable('Quiet!Harbour42x', DEFAULT_PASSWORD_MIN_LENGTH, context),
    ).toBe(true);
  });

  it('is case-insensitive about personal details', () => {
    expect(
      isPasswordAcceptable('aMARA!longEnough1', DEFAULT_PASSWORD_MIN_LENGTH, {
        firstName: 'Amara',
      }),
    ).toBe(false);
  });

  it('reports every requirement so the UI can render a checklist', () => {
    const requirements = evaluatePassword('short', DEFAULT_PASSWORD_MIN_LENGTH);

    expect(requirements).toHaveLength(7);
    expect(requirements.every((requirement) => typeof requirement.met === 'boolean')).toBe(true);
    expect(requirements.find((requirement) => requirement.id === 'length')?.met).toBe(false);
  });

  it('honours a stricter configured minimum length', () => {
    expect(isPasswordAcceptable('Abcdefgh1!xy', 12)).toBe(true);
    expect(isPasswordAcceptable('Abcdefgh1!xy', 20)).toBe(false);
  });

  it('scores strength monotonically', () => {
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('aA1!')).toBeLessThan(passwordStrength('aA1!aA1!aA1!'));
    expect(passwordStrength('aA1!aA1!aA1!aA1!aA1!')).toBe(4);
  });
});

describe('log redaction', () => {
  it('replaces sensitive keys at any depth', () => {
    const redacted = redact({
      email: 'someone@example.com',
      password: 'super-secret',
      nested: { token: 'abc123', authorization: 'Bearer xyz' },
      list: [{ passwordHash: '$2b$12$something' }],
    }) as Record<string, unknown>;

    expect(redacted.email).toBe('someone@example.com');
    expect(redacted.password).toBe('[redacted]');

    const nested = redacted.nested as Record<string, unknown>;
    expect(nested.token).toBe('[redacted]');
    expect(nested.authorization).toBe('[redacted]');

    const list = redacted.list as Record<string, unknown>[];
    expect(list[0]?.passwordHash).toBe('[redacted]');
  });

  it('matches keys regardless of case', () => {
    const redacted = redact({ Password: 'x', TOKEN: 'y' }) as Record<string, unknown>;
    expect(redacted.Password).toBe('[redacted]');
    expect(redacted.TOKEN).toBe('[redacted]');
  });

  it('stops at a depth limit rather than looping on a cycle', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic.self = cyclic;

    expect(() => redact(cyclic)).not.toThrow();
  });

  it('leaves primitives and dates intact', () => {
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBeNull();
    expect(redact(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('CSV export escaping', () => {
  it('quotes values containing a comma, quote or newline', () => {
    expect(escapeCsvValue('plain')).toBe('plain');
    expect(escapeCsvValue('a,b')).toBe('"a,b"');
    expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralises values a spreadsheet would run as a formula', () => {
    // Without the tab prefix, Excel and Sheets execute these on open.
    for (const dangerous of ['=1+1', '+1', '-1', '@SUM(A1)', '=cmd|calc']) {
      const escaped = escapeCsvValue(dangerous);
      expect(escaped.startsWith('"\t') || escaped.startsWith('\t')).toBe(true);
    }
  });

  it('does not mangle an ordinary negative number rendered as text', () => {
    // A leading "-" is still prefixed, because a spreadsheet treats "-1+1" as
    // a formula. The value remains readable.
    expect(escapeCsvValue('-1')).toContain('-1');
  });

  it('renders booleans, dates, objects and null predictably', () => {
    expect(escapeCsvValue(true)).toBe('Yes');
    expect(escapeCsvValue(false)).toBe('No');
    expect(escapeCsvValue(null)).toBe('');
    expect(escapeCsvValue(undefined)).toBe('');
    expect(escapeCsvValue(new Date('2026-03-04T05:06:07Z'))).toBe('2026-03-04T05:06:07.000Z');
    expect(escapeCsvValue({ a: 1 })).toBe('"{""a"":1}"');
  });

  it('builds a CSV with a BOM and CRLF line endings', () => {
    const csv = toCsv(
      [{ name: 'Widget', price: '19.99' }],
      [
        { header: 'Name', value: (row) => row.name },
        { header: 'Price', value: (row) => row.price },
      ],
    );

    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Name,Price\r\n');
    expect(csv).toContain('Widget,19.99\r\n');
  });

  it('keeps columns aligned when a cell contains a delimiter', () => {
    const csv = toCsv(
      [{ name: 'Bolt, 10mm', note: 'fits "M10"' }],
      [
        { header: 'Name', value: (row) => row.name },
        { header: 'Note', value: (row) => row.note },
      ],
    );

    const dataLine = csv.split('\r\n')[1] ?? '';
    expect(dataLine).toBe('"Bolt, 10mm","fits ""M10"""');
  });
});

describe('settings coercion', () => {
  it('coerces a boolean setting from form strings', () => {
    const definition = SETTINGS_BY_KEY.get('checkout.allowGuest');
    expect(definition).toBeDefined();

    expect(coerceSettingValue(definition!, 'true')).toEqual({ ok: true, value: true });
    expect(coerceSettingValue(definition!, 'on')).toEqual({ ok: true, value: true });
    expect(coerceSettingValue(definition!, '')).toEqual({ ok: true, value: false });
    expect(coerceSettingValue(definition!, false)).toEqual({ ok: true, value: false });
  });

  it('enforces the declared numeric range', () => {
    const definition = SETTINGS_BY_KEY.get('checkout.taxRateBps');
    expect(definition).toBeDefined();

    expect(coerceSettingValue(definition!, '2000')).toEqual({ ok: true, value: 2000 });
    expect(coerceSettingValue(definition!, '-1').ok).toBe(false);
    expect(coerceSettingValue(definition!, '10001').ok).toBe(false);
    expect(coerceSettingValue(definition!, '12.5').ok).toBe(false);
    expect(coerceSettingValue(definition!, 'abc').ok).toBe(false);
  });

  it('restricts a setting with options to those options', () => {
    const definition = SETTINGS_BY_KEY.get('store.currency');
    expect(definition).toBeDefined();

    expect(coerceSettingValue(definition!, 'GBP')).toEqual({ ok: true, value: 'GBP' });
    expect(coerceSettingValue(definition!, 'XYZ').ok).toBe(false);
  });

  it('validates the support email address', () => {
    const definition = SETTINGS_BY_KEY.get('store.supportEmail');
    expect(definition).toBeDefined();

    expect(coerceSettingValue(definition!, 'help@example.com').ok).toBe(true);
    expect(coerceSettingValue(definition!, 'not-an-email').ok).toBe(false);
    // Blank is allowed: the field is optional.
    expect(coerceSettingValue(definition!, '').ok).toBe(true);
  });

  it('normalises the order number prefix and rejects bad characters', () => {
    const definition = SETTINGS_BY_KEY.get('checkout.orderNumberPrefix');
    expect(definition).toBeDefined();

    expect(coerceSettingValue(definition!, 'ord')).toEqual({ ok: true, value: 'ORD' });
    expect(coerceSettingValue(definition!, 'ORD-01')).toEqual({ ok: true, value: 'ORD-01' });
    expect(coerceSettingValue(definition!, 'bad prefix!').ok).toBe(false);
  });
});
