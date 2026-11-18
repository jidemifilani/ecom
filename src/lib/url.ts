/**
 * Query-string helpers for list screens.
 *
 * Sorting, filtering and paging all live in the URL. That makes every table
 * state shareable, bookmarkable and reachable with the back button, and it
 * means sorting works before any JavaScript has loaded.
 */

export type SearchParamsInput = Record<string, string | string[] | undefined>;

/** Normalises Next's `searchParams` into a URLSearchParams. */
export const toSearchParams = (input: SearchParamsInput): URLSearchParams => {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      // Repeated keys are collapsed to the first value: no list screen treats
      // a duplicated filter as meaningful, and taking the first is predictable.
      const first = value[0];
      if (first !== undefined) params.set(key, first);
    } else {
      params.set(key, value);
    }
  }

  return params;
};

/**
 * Builds a URL that keeps the current query string and applies `changes`.
 * A null value removes the key. Changing anything other than the page resets
 * paging to 1, so a new filter never lands the user on an empty page 7.
 */
export const buildUrl = (
  pathname: string,
  current: URLSearchParams,
  changes: Record<string, string | number | null | undefined>,
): string => {
  const next = new URLSearchParams(current.toString());
  const changedKeys = Object.keys(changes);

  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value === '') {
      next.delete(key);
    } else {
      next.set(key, String(value));
    }
  }

  if (!changedKeys.includes('page') && changedKeys.length > 0) {
    next.delete('page');
  }

  // Keep URLs tidy: page=1 is the default and adds nothing.
  if (next.get('page') === '1') next.delete('page');

  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
};

/** Curried builder, so a page can hand one function to its table. */
export const urlBuilder =
  (pathname: string, current: URLSearchParams) =>
  (changes: Record<string, string | number | null | undefined>): string =>
    buildUrl(pathname, current, changes);

export const readPage = (params: URLSearchParams): number => {
  const parsed = Number.parseInt(params.get('page') ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

export const readSort = <T extends string>(
  params: URLSearchParams,
  allowed: readonly T[],
  fallback: T,
): { sortBy: T; sortOrder: 'asc' | 'desc' } => {
  const requested = params.get('sortBy');
  const order = params.get('sortOrder');

  return {
    sortBy:
      requested !== null && (allowed as readonly string[]).includes(requested)
        ? (requested as T)
        : fallback,
    sortOrder: order === 'asc' ? 'asc' : 'desc',
  };
};

/** True when any filter, search or date bound is set. Drives "Clear filters". */
export const hasActiveFilters = (
  params: URLSearchParams,
  filterKeys: readonly string[],
): boolean => {
  if ((params.get('q') ?? '') !== '') return true;
  if ((params.get('dateFrom') ?? '') !== '') return true;
  if ((params.get('dateTo') ?? '') !== '') return true;
  return filterKeys.some((key) => (params.get(key) ?? '') !== '');
};
