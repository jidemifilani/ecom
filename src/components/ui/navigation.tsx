import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Home } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

/** Breadcrumbs, tabs and pagination. */

// ── Breadcrumbs ──────────────────────────────────────────────────────────────

export type Crumb = { label: string; href?: string };

export const Breadcrumbs = ({
  items,
  className,
}: {
  items: Crumb[];
  className?: string;
}) => (
  <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
    <ol className="text-fg-muted flex flex-wrap items-center gap-1 text-xs">
      <li className="flex items-center gap-1">
        <Link href="/dashboard" className="hover:text-fg inline-flex items-center gap-1 rounded px-0.5">
          <Home className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Dashboard</span>
        </Link>
      </li>

      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
            <ChevronRight className="size-3.5 shrink-0 opacity-50" aria-hidden="true" />
            {item.href && !isLast ? (
              <Link href={item.href} className="hover:text-fg truncate rounded px-0.5">
                {item.label}
              </Link>
            ) : (
              /* The current page is marked, not linked. */
              <span className="text-fg truncate font-medium" aria-current="page">
                {item.label}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  </nav>
);

// ── Tabs (link-based) ────────────────────────────────────────────────────────

/**
 * Navigation tabs rendered as links, so each tab is a real URL that can be
 * bookmarked, shared and reached with the back button.
 */
export const LinkTabs = ({
  items,
  className,
}: {
  items: { label: string; href: string; active: boolean; count?: number }[];
  className?: string;
}) => (
  <nav
    aria-label="Sections"
    className={cn('border-line table-scroll -mb-px border-b', className)}
  >
    <ul className="flex min-w-max gap-1">
      {items.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            aria-current={item.active ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap',
              'transition-colors duration-150',
              item.active
                ? 'border-accent text-fg'
                : 'text-fg-muted hover:text-fg hover:border-line-strong border-transparent',
            )}
          >
            {item.label}
            {typeof item.count === 'number' ? (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-xs',
                  item.active ? 'bg-accent-soft text-accent' : 'bg-surface-sunken text-fg-muted',
                )}
              >
                {item.count}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  </nav>
);

// ── Pagination ───────────────────────────────────────────────────────────────

/**
 * Builds a compact page window: first, last, the current page and its
 * neighbours, with gaps marked. Keeps the control a fixed width however many
 * pages there are.
 */
const pageWindow = (current: number, total: number): (number | 'gap')[] => {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const pages = new Set<number>([1, total, current]);
  if (current - 1 > 1) pages.add(current - 1);
  if (current + 1 < total) pages.add(current + 1);
  if (current <= 3) {
    pages.add(2);
    pages.add(3);
  }
  if (current >= total - 2) {
    pages.add(total - 1);
    pages.add(total - 2);
  }

  const sorted = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);

  const result: (number | 'gap')[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) result.push('gap');
    result.push(page);
    previous = page;
  }
  return result;
};

export const Pagination = ({
  page,
  pageSize,
  total,
  totalPages,
  buildHref,
  className,
  itemLabel = 'result',
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  buildHref: (page: number) => string;
  className?: string;
  itemLabel?: string;
}) => {
  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const pages = pageWindow(page, totalPages);

  const navButton =
    'grid size-9 place-items-center rounded-control border border-line text-fg-muted hover:bg-surface-sunken hover:text-fg aria-disabled:pointer-events-none aria-disabled:opacity-40';

  return (
    <div
      className={cn(
        'border-line flex flex-col items-center justify-between gap-3 border-t px-4 py-3 sm:flex-row',
        className,
      )}
    >
      {/* aria-live so the range is announced after a page change. */}
      <p className="text-fg-muted text-xs" aria-live="polite">
        Showing <span className="text-fg font-medium">{from}</span> to{' '}
        <span className="text-fg font-medium">{to}</span> of{' '}
        <span className="text-fg font-medium">{total}</span> {itemLabel}
        {total === 1 ? '' : 's'}
      </p>

      {totalPages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center gap-1">
          <Link
            href={buildHref(1)}
            scroll={false}
            aria-disabled={page === 1}
            aria-label="First page"
            className={cn(navButton, 'hidden sm:grid')}
          >
            <ChevronsLeft className="size-4" aria-hidden="true" />
          </Link>
          <Link
            href={buildHref(Math.max(1, page - 1))}
            scroll={false}
            aria-disabled={page === 1}
            aria-label="Previous page"
            className={navButton}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Link>

          <ul className="flex items-center gap-1">
            {pages.map((entry, index) =>
              entry === 'gap' ? (
                <li
                  key={`gap-${index}`}
                  className="text-fg-subtle grid size-9 place-items-center text-sm"
                  aria-hidden="true"
                >
                  ...
                </li>
              ) : (
                <li key={entry}>
                  <Link
                    href={buildHref(entry)}
                    scroll={false}
                    aria-current={entry === page ? 'page' : undefined}
                    aria-label={`Page ${entry}`}
                    className={cn(
                      'grid size-9 place-items-center rounded-control border text-sm font-medium',
                      entry === page
                        ? 'border-primary bg-primary text-on-primary'
                        : 'border-line text-fg-muted hover:bg-surface-sunken hover:text-fg',
                    )}
                  >
                    {entry}
                  </Link>
                </li>
              ),
            )}
          </ul>

          <Link
            href={buildHref(Math.min(totalPages, page + 1))}
            scroll={false}
            aria-disabled={page === totalPages}
            aria-label="Next page"
            className={navButton}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
          <Link
            href={buildHref(totalPages)}
            scroll={false}
            aria-disabled={page === totalPages}
            aria-label="Last page"
            className={cn(navButton, 'hidden sm:grid')}
          >
            <ChevronsRight className="size-4" aria-hidden="true" />
          </Link>
        </nav>
      ) : null}
    </div>
  );
};
