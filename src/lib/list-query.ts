import { parseListQuery, type ListQuery, type ParseListQueryOptions } from './api/query';
import { logger } from './logger';

/**
 * Page-side list query parsing.
 *
 * API routes use `parseListQuery` directly: a malformed query string there is a
 * client error and deserves a 422. A *page* must not 500 because somebody
 * hand-edited the URL, so this wrapper falls back to the defaults and logs the
 * problem instead of throwing.
 *
 * Both paths share one parser, so page and API agree on what a query means.
 */
export const safeListQuery = <TSort extends string>(
  searchParams: URLSearchParams,
  options: ParseListQueryOptions<TSort>,
): ListQuery<TSort> => {
  try {
    return parseListQuery(searchParams, options);
  } catch (error) {
    logger.debug('Falling back to default list query', {
      query: searchParams.toString(),
      error: error instanceof Error ? error.message : error,
    });

    // Re-parse with nothing but the allow-listed filters, which cannot fail.
    const clean = new URLSearchParams();
    for (const key of options.filterKeys ?? []) {
      const value = searchParams.get(key);
      if (value) clean.set(key, value);
    }
    const sortBy = searchParams.get('sortBy');
    if (sortBy && (options.sortable as readonly string[]).includes(sortBy)) {
      clean.set('sortBy', sortBy);
    }

    return parseListQuery(clean, options);
  }
};
