'use client';

import { Search, SlidersHorizontal, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useState, useTransition } from 'react';

import { useSyncedState } from '@/hooks/use-synced-state';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Spinner } from '@/components/ui/feedback';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/overlay';
import { cn } from '@/lib/utils';

/**
 * Search and filter controls for list screens.
 *
 * All state lives in the URL, so a filtered view can be shared and the back
 * button works. Search is debounced and uses `router.replace`, which keeps the
 * browser history from filling with one entry per keystroke.
 *
 * On phones the filters collapse into a slide-over sheet, so the toolbar stays
 * one row high at 320px.
 */

export type FilterOption = { value: string; label: string };

export type FilterDefinition = {
  /** Query-string key. Must be in the route's `filterKeys`. */
  key: string;
  label: string;
  options: FilterOption[];
  /** Label for the "no filter" option. */
  anyLabel?: string;
};

const DEBOUNCE_MS = 350;

export const FilterBar = ({
  searchPlaceholder = 'Search',
  filters = [],
  showDateRange = false,
  rightSlot,
}: {
  searchPlaceholder?: string;
  filters?: FilterDefinition[];
  showDateRange?: boolean;
  /** Export buttons, "New" actions and so on. */
  rightSlot?: React.ReactNode;
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const searchId = useId();

  const [sheetOpen, setSheetOpen] = useState(false);

  // Keep the field in step when the URL changes from elsewhere (the back
  // button, "clear filters") without fighting the user mid-type.
  const urlTerm = searchParams.get('q') ?? '';
  const [term, setTerm] = useSyncedState(urlTerm, () => urlTerm);

  const push = (changes: Record<string, string | null>): void => {
    const next = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }

    // Any change other than paging returns to the first page.
    next.delete('page');

    const query = next.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  };

  // Debounced search.
  useEffect(() => {
    if (term === urlTerm) return;

    const timer = setTimeout(() => {
      push({ q: term.trim() || null });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `push` is stable enough for this purpose and intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, urlTerm]);

  const activeFilterCount =
    filters.filter((filter) => (searchParams.get(filter.key) ?? '') !== '').length +
    (showDateRange && (searchParams.get('dateFrom') || searchParams.get('dateTo')) ? 1 : 0);

  const hasAnything = activeFilterCount > 0 || urlTerm !== '';

  const clearHref = (() => {
    const next = new URLSearchParams(searchParams.toString());
    for (const filter of filters) next.delete(filter.key);
    next.delete('q');
    next.delete('dateFrom');
    next.delete('dateTo');
    next.delete('page');
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  })();

  const filterControls = (
    <>
      {filters.map((filter) => (
        <label key={filter.key} className="block">
          <span className="text-fg-muted mb-1 block text-xs font-medium md:sr-only">
            {filter.label}
          </span>
          <Select
            value={searchParams.get(filter.key) ?? ''}
            onChange={(event) => push({ [filter.key]: event.target.value || null })}
            aria-label={filter.label}
            className="h-10 md:w-auto md:min-w-36"
          >
            <option value="">{filter.anyLabel ?? `All ${filter.label.toLowerCase()}`}</option>
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
      ))}

      {showDateRange ? (
        <div className="grid grid-cols-2 gap-2 md:flex md:items-end">
          <label className="block">
            <span className="text-fg-muted mb-1 block text-xs font-medium">From</span>
            <input
              type="date"
              value={searchParams.get('dateFrom') ?? ''}
              onChange={(event) => push({ dateFrom: event.target.value || null })}
              aria-label="From date"
              className="border-line-strong bg-surface text-fg rounded-control h-10 w-full border px-2.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-fg-muted mb-1 block text-xs font-medium">To</span>
            <input
              type="date"
              value={searchParams.get('dateTo') ?? ''}
              onChange={(event) => push({ dateTo: event.target.value || null })}
              aria-label="To date"
              className="border-line-strong bg-surface text-fg rounded-control h-10 w-full border px-2.5 text-sm"
            />
          </label>
        </div>
      ) : null}
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative min-w-0 flex-1 md:max-w-xs">
          <label htmlFor={searchId} className="sr-only">
            {searchPlaceholder}
          </label>
          <Search
            className="text-fg-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            id={searchId}
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={searchPlaceholder}
            className="border-line-strong bg-surface text-fg placeholder:text-fg-subtle rounded-control h-10 w-full border pr-9 pl-9 text-sm"
          />
          {pending ? (
            <span className="absolute top-1/2 right-3 -translate-y-1/2">
              <Spinner label="Updating results" />
            </span>
          ) : term ? (
            <button
              type="button"
              onClick={() => setTerm('')}
              aria-label="Clear search"
              className="text-fg-subtle hover:text-fg absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center rounded"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {/* Filters: inline from md, sheet below */}
        {filters.length > 0 || showDateRange ? (
          <>
            <div className="hidden flex-wrap items-end gap-2 md:flex">{filterControls}</div>

            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="md:hidden">
                  <SlidersHorizontal aria-hidden="true" />
                  Filters
                  {activeFilterCount > 0 ? (
                    <span className="bg-accent text-on-accent ml-0.5 grid size-5 place-items-center rounded-full text-xs font-semibold">
                      {activeFilterCount}
                    </span>
                  ) : null}
                </Button>
              </SheetTrigger>

              <SheetContent side="right" label="Filters" className="p-0">
                <div className="border-line flex h-14 shrink-0 items-center border-b px-4">
                  <span className="text-fg text-sm font-semibold">Filters</span>
                </div>
                <div className="flex-1 space-y-4 overflow-y-auto p-4">{filterControls}</div>
                <div className="border-line safe-bottom flex gap-2 border-t p-4">
                  {hasAnything ? (
                    <Button variant="outline" block asChild>
                      <Link href={clearHref} onClick={() => setSheetOpen(false)}>
                        Clear all
                      </Link>
                    </Button>
                  ) : null}
                  <Button block onClick={() => setSheetOpen(false)}>
                    Show results
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          </>
        ) : null}

        {hasAnything ? (
          <Button variant="ghost" size="sm" asChild className="hidden md:inline-flex">
            <Link href={clearHref}>
              <X aria-hidden="true" />
              Clear
            </Link>
          </Button>
        ) : null}

        <div className="ml-auto flex items-center gap-2">{rightSlot}</div>
      </div>

      {/* Live region so screen-reader users hear that results changed. */}
      <p aria-live="polite" className="sr-only">
        {pending ? 'Updating results' : 'Results updated'}
      </p>
    </div>
  );
};

/** Sort control for screens where a dropdown reads better than table headers. */
export const SortSelect = ({
  options,
  className,
}: {
  options: { value: string; label: string; order?: 'asc' | 'desc' }[];
  className?: string;
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const current = `${searchParams.get('sortBy') ?? ''}:${searchParams.get('sortOrder') ?? ''}`;

  return (
    <label className={cn('block', className)}>
      <span className="sr-only">Sort results</span>
      <Select
        value={current}
        onChange={(event) => {
          const [sortBy, sortOrder] = event.target.value.split(':');
          const next = new URLSearchParams(searchParams.toString());
          if (sortBy) next.set('sortBy', sortBy);
          if (sortOrder) next.set('sortOrder', sortOrder);
          next.delete('page');
          router.replace(`${pathname}?${next.toString()}`, { scroll: false });
        }}
        aria-label="Sort results"
        className="h-10"
      >
        {options.map((option) => (
          <option
            key={`${option.value}:${option.order ?? 'desc'}`}
            value={`${option.value}:${option.order ?? 'desc'}`}
          >
            {option.label}
          </option>
        ))}
      </Select>
    </label>
  );
};
