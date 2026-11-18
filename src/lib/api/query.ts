import { z } from 'zod';

import { ValidationError, type FieldError } from './errors';

/**
 * List-query parsing for every collection endpoint.
 *
 * `sortBy` is validated against a per-resource allow-list before it ever
 * reaches Prisma's `orderBy`, so a caller cannot probe arbitrary columns or
 * relations through the query string.
 */

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export type SortOrder = 'asc' | 'desc';

export type ListQuery<TSortField extends string> = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  search: string | undefined;
  sortBy: TSortField;
  sortOrder: SortOrder;
  /** Values present in the query string, already allow-listed by the caller. */
  filters: Record<string, string>;
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  /** True when the caller asked to include soft-deleted rows (needs permission). */
  includeArchived: boolean;
};

const baseSchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  q: z.string().trim().max(200).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type ParseListQueryOptions<TSortField extends string> = {
  /** Columns the client may sort by. The first entry is the default. */
  sortable: readonly TSortField[];
  defaultSort?: TSortField;
  defaultSortOrder?: SortOrder;
  /** Query-string keys treated as equality filters. */
  filterKeys?: readonly string[];
  defaultPageSize?: number;
};

export const parseListQuery = <TSortField extends string>(
  searchParams: URLSearchParams,
  options: ParseListQueryOptions<TSortField>,
): ListQuery<TSortField> => {
  const raw = Object.fromEntries(searchParams.entries());
  const parsed = baseSchema.safeParse({
    ...raw,
    pageSize: raw.pageSize ?? options.defaultPageSize ?? DEFAULT_PAGE_SIZE,
    sortOrder: raw.sortOrder ?? options.defaultSortOrder ?? 'desc',
  });

  if (!parsed.success) {
    throw new ValidationError(toFieldErrors(parsed.error));
  }

  const fallbackSort = options.defaultSort ?? options.sortable[0];
  if (fallbackSort === undefined) {
    throw new Error('parseListQuery requires at least one sortable field');
  }

  const requestedSort = searchParams.get('sortBy');
  const sortBy =
    requestedSort !== null && (options.sortable as readonly string[]).includes(requestedSort)
      ? (requestedSort as TSortField)
      : fallbackSort;

  const filters: Record<string, string> = {};
  for (const key of options.filterKeys ?? []) {
    const value = searchParams.get(key);
    if (value !== null && value.trim() !== '') filters[key] = value.trim();
  }

  const { page, pageSize, q, sortOrder, dateFrom, dateTo, includeArchived } = parsed.data;

  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new ValidationError([
      { path: 'dateFrom', message: 'The start date must be on or before the end date.' },
    ]);
  }

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
    search: q && q.length > 0 ? q : undefined,
    sortBy,
    sortOrder,
    filters,
    dateFrom,
    dateTo,
    includeArchived,
  };
};

/** Flattens a Zod error into the API's field-error shape. */
export const toFieldErrors = (error: z.ZodError): FieldError[] =>
  error.issues.map((issue) => ({
    path: issue.path.map(String).join('.') || '(root)',
    message: issue.message,
  }));

/** Validates a request body against a schema, throwing a 422 on failure. */
export const parseBody = <TSchema extends z.ZodType>(
  schema: TSchema,
  body: unknown,
): z.output<TSchema> => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(toFieldErrors(parsed.error));
  }
  return parsed.data;
};

/** Builds an inclusive date filter for Prisma from the parsed range. */
export const dateRangeFilter = (
  from: Date | undefined,
  to: Date | undefined,
): { gte?: Date; lte?: Date } | undefined => {
  if (!from && !to) return undefined;
  const filter: { gte?: Date; lte?: Date } = {};
  if (from) filter.gte = from;
  if (to) {
    // Treat a bare date as "end of that day" so `dateTo=2026-01-31` includes it.
    const end = new Date(to);
    if (end.getUTCHours() === 0 && end.getUTCMinutes() === 0 && end.getUTCSeconds() === 0) {
      end.setUTCHours(23, 59, 59, 999);
    }
    filter.lte = end;
  }
  return filter;
};
