import { describe, expect, it } from 'vitest';

import {
  applyBasisPoints,
  clampDiscount,
  formatMoney,
  minorUnitExponent,
  percentageDiscount,
  roundHalfUp,
  sumMinor,
  toMajorString,
  toMajorUnits,
  toMinorUnits,
} from '@/lib/money';

/**
 * Money is the part of this application where a rounding mistake becomes a
 * financial one, so these tests cover the awkward cases rather than the happy
 * path: half-way rounding, zero-decimal currencies, and the float artefacts
 * that make `19.99 * 100` not equal 1999.
 */

describe('toMinorUnits', () => {
  it('converts a major-unit string to minor units', () => {
    expect(toMinorUnits('19.99', 'USD')).toBe(1999);
    expect(toMinorUnits('0.01', 'USD')).toBe(1);
    expect(toMinorUnits('1000', 'USD')).toBe(100_000);
  });

  it('survives the classic float artefacts', () => {
    // 19.99 * 100 is 1998.9999999999998 in IEEE-754.
    expect(toMinorUnits('19.99', 'USD')).toBe(1999);
    expect(toMinorUnits('0.29', 'USD')).toBe(29);
    expect(toMinorUnits('1.005', 'USD')).toBe(101);
    expect(toMinorUnits('8.165', 'USD')).toBe(817);
  });

  it('accepts thousands separators and surrounding whitespace', () => {
    expect(toMinorUnits(' 1,234.50 ', 'USD')).toBe(123_450);
  });

  it('respects zero-decimal currencies', () => {
    expect(minorUnitExponent('JPY')).toBe(0);
    expect(toMinorUnits('2500', 'JPY')).toBe(2500);
    expect(toMinorUnits('2500.00', 'JPY')).toBe(2500);
  });

  it('respects three-decimal currencies', () => {
    expect(minorUnitExponent('KWD')).toBe(3);
    expect(toMinorUnits('1.234', 'KWD')).toBe(1234);
  });

  it('returns null rather than NaN for unparseable input', () => {
    expect(toMinorUnits('', 'USD')).toBeNull();
    expect(toMinorUnits('abc', 'USD')).toBeNull();
    expect(toMinorUnits('12.34.56', 'USD')).toBeNull();
    expect(toMinorUnits('1e5', 'USD')).toBeNull();
  });

  it('round-trips through major units without drift', () => {
    for (const amount of ['0.01', '19.99', '123.45', '999999.99']) {
      const minor = toMinorUnits(amount, 'USD');
      expect(minor).not.toBeNull();
      expect(toMajorString(minor as number, 'USD')).toBe(amount);
    }
  });
});

describe('roundHalfUp', () => {
  it('rounds halves away from zero, which is what invoices expect', () => {
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(1.5)).toBe(2);
    expect(roundHalfUp(2.5)).toBe(3);
    // Math.round(-2.5) is -2; invoices want -3.
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(-0.5)).toBe(-1);
  });
});

describe('applyBasisPoints', () => {
  it('applies a percentage expressed in basis points', () => {
    expect(applyBasisPoints(10_000, 1000)).toBe(1000); // 10% of 100.00
    expect(applyBasisPoints(1999, 2000)).toBe(400); // 20% of 19.99 -> 4.00
    expect(applyBasisPoints(100, 0)).toBe(0);
  });

  it('rounds to a whole minor unit', () => {
    // 7.5% of 1.00 is 7.5 cents, which must become 8.
    expect(applyBasisPoints(100, 750)).toBe(8);
  });
});

describe('percentageDiscount', () => {
  it('caps the discount when a maximum is set', () => {
    expect(percentageDiscount(100_000, 2000, null)).toBe(20_000);
    expect(percentageDiscount(100_000, 2000, 5000)).toBe(5000);
  });

  it('ignores the cap when it is not reached', () => {
    expect(percentageDiscount(10_000, 1000, 5000)).toBe(1000);
  });
});

describe('clampDiscount', () => {
  it('never lets a discount exceed the subtotal', () => {
    expect(clampDiscount(1000, 2000)).toBe(1000);
    expect(clampDiscount(1000, 400)).toBe(400);
  });

  it('never returns a negative discount', () => {
    expect(clampDiscount(1000, -50)).toBe(0);
  });
});

describe('formatMoney', () => {
  it('formats with the correct number of decimals per currency', () => {
    expect(formatMoney(1999, 'USD', 'en-US')).toBe('$19.99');
    expect(formatMoney(2500, 'JPY', 'en-US')).toBe('¥2,500');
  });

  it('renders currencies whose symbol needs extended glyphs', () => {
    const formatted = formatMoney(500_000, 'NGN', 'en-NG');
    expect(formatted).toContain('5,000');
    // The naira sign must survive, not degrade to "NGN" or a box.
    expect(formatted).toMatch(/[₦N]/);
  });

  it('still renders an amount for an unrecognised but well-formed code', () => {
    // Intl accepts any three-letter code and prefixes it, using a
    // non-breaking space, so normalise before comparing.
    const formatted = formatMoney(1999, 'ZZZ', 'en-US').replace(/ /g, ' ');
    expect(formatted).toBe('ZZZ 19.99');
  });
});

describe('sumMinor and toMajorUnits', () => {
  it('sums integer amounts exactly', () => {
    expect(sumMinor([1999, 2999, 1])).toBe(4999);
    expect(sumMinor([])).toBe(0);
  });

  it('converts back to a major-unit number', () => {
    expect(toMajorUnits(1999, 'USD')).toBeCloseTo(19.99, 10);
    expect(toMajorUnits(2500, 'JPY')).toBe(2500);
  });
});
