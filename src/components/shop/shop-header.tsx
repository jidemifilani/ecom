'use client';

import { Menu, Search, ShoppingBag, ShoppingCart, User, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useSyncedState } from '@/hooks/use-synced-state';

import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/overlay';
import { cn } from '@/lib/utils';

/**
 * Storefront header.
 *
 * The cart count is rendered from a server-provided value so it is correct on
 * first paint, then kept in step by a `shop:cart-updated` window event that the
 * cart mutations dispatch. That avoids polling and avoids a full page refresh
 * just to move a number.
 */

export type ShopNavCategory = { name: string; slug: string; children: { name: string; slug: string }[] };

export const ShopHeader = ({
  storeName,
  categories,
  initialCartCount,
  isSignedIn,
  customerFirstName,
}: {
  storeName: string;
  categories: ShopNavCategory[];
  initialCartCount: number;
  isSignedIn: boolean;
  customerFirstName: string | null;
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The server-rendered count wins whenever the page re-renders.
  const [cartCount, setCartCount] = useSyncedState(
    initialCartCount,
    () => initialCartCount,
  );
  // Close the drawer on navigation, including browser back and forward.
  const [menuOpen, setMenuOpen] = useSyncedState(pathname, () => false);
  const [term, setTerm] = useState(searchParams.get('q') ?? '');

  // Cart mutations dispatch this so the badge updates without a navigation.
  useEffect(() => {
    const onUpdate = (event: Event): void => {
      const detail = (event as CustomEvent<{ itemCount: number }>).detail;
      if (detail && typeof detail.itemCount === 'number') setCartCount(detail.itemCount);
    };

    window.addEventListener('shop:cart-updated', onUpdate);
    return () => window.removeEventListener('shop:cart-updated', onUpdate);
  }, [setCartCount]);

  const submitSearch = (event: React.FormEvent): void => {
    event.preventDefault();
    const trimmed = term.trim();
    router.push(trimmed === '' ? '/search' : `/search?q=${encodeURIComponent(trimmed)}`);
  };

  const navLinks = (
    <ul className="flex flex-col gap-1 lg:flex-row lg:items-center lg:gap-1">
      {categories.map((category) => {
        const active = pathname === `/c/${category.slug}`;
        return (
          <li key={category.slug}>
            <Link
              href={`/c/${category.slug}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-control block px-3 py-2.5 text-sm font-medium lg:py-2',
                active
                  ? 'bg-surface-sunken text-fg'
                  : 'text-fg-muted hover:bg-surface-sunken hover:text-fg',
              )}
            >
              {category.name}
            </Link>

            {/* Subcategories are listed inline in the mobile drawer only. */}
            {category.children.length > 0 ? (
              <ul className="mt-0.5 ml-3 flex flex-col gap-0.5 lg:hidden">
                {category.children.map((child) => (
                  <li key={child.slug}>
                    <Link
                      href={`/c/${child.slug}`}
                      className="text-fg-subtle hover:text-fg block rounded px-3 py-2 text-sm"
                    >
                      {child.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <header className="border-line bg-surface/95 sticky top-0 z-30 border-b backdrop-blur-md">
      <div className="mx-auto w-full max-w-[90rem] px-3 sm:px-4 lg:px-6">
        <div className="flex h-14 items-center gap-2 sm:h-16 sm:gap-3">
          {/* Mobile menu */}
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-fg-muted lg:hidden"
                aria-label="Open menu"
              >
                <Menu className="size-5" aria-hidden="true" />
              </Button>
            </SheetTrigger>

            <SheetContent side="left" label="Shop menu" className="p-0">
              <div className="border-line flex h-14 shrink-0 items-center px-4">
                <span className="text-fg text-sm font-semibold">{storeName}</span>
              </div>
              <nav aria-label="Categories" className="flex-1 overflow-y-auto p-2">
                {navLinks}
              </nav>
              <div className="border-line safe-bottom border-t p-3">
                <Button variant="outline" block asChild>
                  <Link href={isSignedIn ? '/account' : '/account/login'}>
                    <User aria-hidden="true" />
                    {isSignedIn ? 'Your account' : 'Sign in'}
                  </Link>
                </Button>
              </div>
            </SheetContent>
          </Sheet>

          <Link href="/" className="flex shrink-0 items-center gap-2" aria-label={`${storeName} home`}>
            <span
              aria-hidden="true"
              className="bg-primary text-on-primary grid size-8 place-items-center rounded-md"
            >
              <ShoppingBag className="size-4" />
            </span>
            <span className="text-fg hidden text-sm font-semibold sm:inline">{storeName}</span>
          </Link>

          <nav aria-label="Categories" className="hidden min-w-0 flex-1 lg:block">
            {navLinks}
          </nav>

          {/* Search */}
          <form onSubmit={submitSearch} role="search" className="relative min-w-0 flex-1 lg:max-w-xs">
            <label htmlFor="shop-search" className="sr-only">
              Search products
            </label>
            <Search
              className="text-fg-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              id="shop-search"
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search"
              className="border-line-strong bg-surface text-fg placeholder:text-fg-subtle rounded-control h-10 w-full border pr-8 pl-9 text-sm"
            />
            {term ? (
              <button
                type="button"
                onClick={() => setTerm('')}
                aria-label="Clear search"
                className="text-fg-subtle hover:text-fg absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center rounded"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </form>

          <div className="flex shrink-0 items-center gap-1">
            <ThemeToggle />

            <Button
              variant="ghost"
              size="icon-sm"
              className="text-fg-muted hidden sm:inline-flex"
              asChild
            >
              <Link
                href={isSignedIn ? '/account' : '/account/login'}
                aria-label={
                  isSignedIn && customerFirstName
                    ? `Your account, signed in as ${customerFirstName}`
                    : 'Sign in to your account'
                }
              >
                <User className="size-4" aria-hidden="true" />
              </Link>
            </Button>

            <Button variant="ghost" size="icon-sm" className="text-fg-muted relative" asChild>
              <Link
                href="/cart"
                aria-label={
                  cartCount === 0
                    ? 'Basket, empty'
                    : `Basket, ${cartCount} item${cartCount === 1 ? '' : 's'}`
                }
              >
                <ShoppingCart className="size-4" aria-hidden="true" />
                {cartCount > 0 ? (
                  <span
                    aria-hidden="true"
                    className="bg-accent text-on-accent absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full px-1 text-[10px] leading-4 font-semibold"
                  >
                    {cartCount > 9 ? '9+' : cartCount}
                  </span>
                ) : null}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
};
