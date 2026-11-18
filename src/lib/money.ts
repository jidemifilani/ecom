/**
 * Money handling.
 *
 * Every monetary value in this application is an integer number of MINOR units
 * (cents, kobo, pence) paired with an ISO-4217 code. Nothing here ever returns
 * a float, and formatted strings are display-only - never parse them back.
 */

/** Currencies whose minor unit is not 1/100. Extend as markets are added. */
const MINOR_UNIT_EXPONENTS: Record<string, number> = {
  BHD: 3,
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  IQD: 3,
  ISK: 0,
  JOD: 3,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  PYG: 0,
  RWF: 0,
  TND: 3,
  UGX: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
};

export const minorUnitExponent = (currency: string): number =>
  MINOR_UNIT_EXPONENTS[currency.toUpperCase()] ?? 2;

const factorFor = (currency: string): number => 10 ** minorUnitExponent(currency);

/** Rounds half away from zero, which is what invoices and tax tables expect. */
export const roundHalfUp = (value: number): number =>
  value < 0 ? -Math.round(-value) : Math.round(value);

const DECIMAL_RE = /^(-?)(\d*)(?:\.(\d*))?$/;

/**
 * Converts a human-entered major-unit amount ("19.99") into minor units (1999).
 * Returns null when the input is not a finite decimal number, so callers can
 * surface a validation error rather than silently storing a wrong price.
 *
 * The conversion shifts the decimal point textually rather than multiplying by
 * a power of ten. That matters: `1.005` is stored as 1.00499999999999989 in
 * IEEE-754, so `1.005 * 100` is 100.4999... and would round DOWN to 100 --
 * charging a customer a cent less than the price on the label. Working on the
 * digits gives the arithmetically correct 101.
 */
export const toMinorUnits = (input: string | number, currency = 'USD'): number | null => {
  const raw = typeof input === 'number' ? String(input) : input.trim().replace(/,/g, '');

  const match = DECIMAL_RE.exec(raw);
  if (!match) return null;

  const [, sign, wholePart = '', fractionPart = ''] = match;

  // Reject input with no digits at all ("", ".", "-").
  if (wholePart === '' && fractionPart === '') return null;

  const exponent = minorUnitExponent(currency);
  const whole = wholePart === '' ? '0' : wholePart;

  // Keep `exponent` fractional digits, rounding half-up on the next one.
  const kept = fractionPart.slice(0, exponent).padEnd(exponent, '0');
  const nextDigit = fractionPart.charAt(exponent);
  const roundUp = nextDigit !== '' && Number(nextDigit) >= 5;

  const magnitude = Number(`${whole}${kept}`) + (roundUp ? 1 : 0);
  if (!Number.isFinite(magnitude)) return null;

  return sign === '-' ? -magnitude : magnitude;
};

/** Converts minor units back to a major-unit number, for inputs and exports. */
export const toMajorUnits = (minor: number, currency = 'USD'): number =>
  minor / factorFor(currency);

/** Fixed-decimal major-unit string, e.g. 1999 -> "19.99". Safe for CSV export. */
export const toMajorString = (minor: number, currency = 'USD'): string =>
  toMajorUnits(minor, currency).toFixed(minorUnitExponent(currency));

/** Localised currency string for display, e.g. "$19.99". */
export const formatMoney = (minor: number, currency = 'USD', locale = 'en-US'): string => {
  const exponent = minorUnitExponent(currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(toMajorUnits(minor, currency));
  } catch {
    // Unknown currency code: fall back to a plain, unambiguous rendering.
    return `${currency.toUpperCase()} ${toMajorString(minor, currency)}`;
  }
};

/** Applies a basis-point rate (1000 bps = 10%) to a minor-unit amount. */
export const applyBasisPoints = (minor: number, basisPoints: number): number =>
  roundHalfUp((minor * basisPoints) / 10_000);

/** Percentage of a minor amount, expressed in basis points, capped if asked. */
export const percentageDiscount = (
  minor: number,
  basisPoints: number,
  maxAmount?: number | null,
): number => {
  const raw = applyBasisPoints(minor, basisPoints);
  if (maxAmount === undefined || maxAmount === null) return raw;
  return Math.min(raw, maxAmount);
};

export const sumMinor = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);

/** Clamps a discount so a line or order total can never go negative. */
export const clampDiscount = (subtotal: number, discount: number): number =>
  Math.max(0, Math.min(subtotal, discount));
