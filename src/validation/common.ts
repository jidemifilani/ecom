import { z } from 'zod';

/**
 * Shared field primitives.
 *
 * Every schema in this folder is isomorphic: the API validates with it, and the
 * forms resolve against the same object through `@hookform/resolvers`. A rule
 * therefore cannot drift between client and server.
 *
 * Error messages are written for end users, because they are rendered verbatim
 * next to the field that produced them.
 */

export const uuidSchema = z.uuid('That identifier is not valid.');

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Enter an email address.')
  .max(255, 'That email address is too long.')
  .toLowerCase()
  .pipe(z.email('Enter a valid email address.'));

export const requiredText = (label: string, max = 240) =>
  z
    .string()
    .trim()
    .min(1, `Enter ${label}.`)
    .max(max, `${label[0]?.toUpperCase()}${label.slice(1)} must be ${max} characters or fewer.`);

export const optionalText = (max = 240) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer.`)
    .optional()
    .transform((value) => (value === '' ? undefined : value));

export const slugSchema = z
  .string()
  .trim()
  .min(1, 'Enter a URL slug.')
  .max(180, 'That slug is too long.')
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Use lower-case letters, numbers and single hyphens only.',
  );

export const phoneSchema = z
  .string()
  .trim()
  .max(32, 'That phone number is too long.')
  .regex(/^[+0-9()\-\s]*$/, 'Use digits, spaces and + ( ) - only.')
  .optional()
  .transform((value) => (value === '' ? undefined : value));

export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(3, 'Use a three-letter currency code, such as USD.')
  .regex(/^[A-Z]{3}$/, 'Use a three-letter currency code, such as USD.');

export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(2, 'Use a two-letter country code, such as GB.')
  .regex(/^[A-Z]{2}$/, 'Use a two-letter country code, such as GB.');

/**
 * A monetary amount in MINOR units. Accepts the string a number input yields
 * and rejects anything fractional, because minor units are indivisible.
 */
export const moneyMinorSchema = (label = 'amount') =>
  z.coerce
    .number({ error: `Enter a valid ${label}.` })
    .int(`The ${label} cannot include a fraction of a cent.`)
    .min(0, `The ${label} cannot be negative.`)
    .max(9_999_999_999, `That ${label} is too large.`);

export const optionalMoneyMinorSchema = (label = 'amount') =>
  z
    .union([z.literal(''), moneyMinorSchema(label)])
    .optional()
    .transform((value) => (value === '' || value === undefined ? undefined : value));

export const quantitySchema = z.coerce
  .number({ error: 'Enter a quantity.' })
  .int('Quantities must be whole numbers.')
  .min(0, 'Quantities cannot be negative.')
  .max(1_000_000, 'That quantity is too large.');

export const positiveQuantitySchema = z.coerce
  .number({ error: 'Enter a quantity.' })
  .int('Quantities must be whole numbers.')
  .min(1, 'Enter a quantity of at least 1.')
  .max(1_000_000, 'That quantity is too large.');

/** Basis points: 1000 = 10%. Used for tax and percentage discounts. */
export const basisPointsSchema = z.coerce
  .number({ error: 'Enter a percentage.' })
  .int('Use whole basis points (1% = 100).')
  .min(0, 'A percentage cannot be negative.')
  .max(10_000, 'A percentage cannot exceed 100%.');

export const urlSchema = z
  .string()
  .trim()
  .max(2048, 'That URL is too long.')
  .optional()
  .transform((value) => (value === '' ? undefined : value))
  .refine(
    (value) => value === undefined || /^https?:\/\//.test(value) || value.startsWith('/'),
    'Enter an absolute http(s) URL or a path beginning with /.',
  );

export const isoDateSchema = z
  .union([z.literal(''), z.coerce.date()])
  .optional()
  .transform((value) => (value === '' || value === undefined ? undefined : value));

/** Accepts a checkbox value from a form as well as a real boolean. */
export const checkboxSchema = z
  .union([z.boolean(), z.enum(['true', 'false', 'on', ''])])
  .default(false)
  .transform((value) => value === true || value === 'true' || value === 'on');

export const idParamSchema = z.object({ id: uuidSchema });

export type IdParam = z.infer<typeof idParamSchema>;

/** Bulk action payload used by several list screens. */
export const bulkIdsSchema = z.object({
  ids: z
    .array(uuidSchema)
    .min(1, 'Select at least one record.')
    .max(200, 'Select 200 records or fewer at a time.'),
});
