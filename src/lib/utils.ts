import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges conditional class names, de-duplicating conflicting Tailwind utilities. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));

const SLUG_STRIP = /[^a-z0-9]+/g;
const SLUG_TRIM = /^-+|-+$/g;
const COMBINING_MARKS = /[̀-ͯ]/g;

export const slugify = (input: string): string =>
  input
    .normalize('NFKD')
    // Strip combining marks so accented Latin and Yoruba text degrade to ASCII
    // instead of being dropped entirely.
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(SLUG_STRIP, '-')
    .replace(SLUG_TRIM, '')
    .slice(0, 180);

export const truncate = (input: string, length: number): string =>
  input.length <= length ? input : `${input.slice(0, Math.max(0, length - 1)).trimEnd()}...`;

export const initials = (first: string, last: string): string =>
  `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || '?';

export const fullName = (first: string, last: string): string => `${first} ${last}`.trim();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_RE.test(value);

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const unique = <T,>(values: readonly T[]): T[] => Array.from(new Set(values));

export const groupBy = <T, K extends string>(
  items: readonly T[],
  keyOf: (item: T) => K,
): Record<K, T[]> => {
  const result = {} as Record<K, T[]>;
  for (const item of items) {
    const key = keyOf(item);
    (result[key] ??= []).push(item);
  }
  return result;
};

/** Percentage change between two periods, or null when the base is zero. */
export const percentChange = (current: number, previous: number): number | null => {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
};

export const pluralize = (count: number, singular: string, plural = `${singular}s`): string =>
  count === 1 ? singular : plural;

/** Removes undefined values so Prisma does not interpret them as `null`. */
export const compact = <T extends Record<string, unknown>>(input: T): Partial<T> => {
  const output: Partial<T> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key as keyof T] = value as T[keyof T];
  }
  return output;
};

/** Stable, human-readable date for tables and exports. */
export const formatDateTime = (value: Date | string | null | undefined): string => {
  if (!value) return '-';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

export const formatDate = (value: Date | string | null | undefined): string => {
  if (!value) return '-';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(date);
};

export const formatNumber = (value: number): string =>
  new Intl.NumberFormat('en-US').format(value);
