import Link from 'next/link';

import { ShopHeader, type ShopNavCategory } from '@/components/shop/shop-header';
import { TooltipProvider } from '@/components/ui/menu';
import { getCurrentCustomer } from '@/lib/auth/current-user';
import { resolveCartIdentity } from '@/lib/shop';
import { getCartView } from '@/server/cart-service';
import { getCategoryTree } from '@/server/catalog-service';
import { getStoreConfig } from '@/server/settings-service';

/**
 * Storefront layout.
 *
 * The cart count is resolved server-side so the badge is correct in the first
 * HTML, rather than appearing a moment after hydration.
 *
 * Reading the cart creates one if the visitor has none. That is deliberate:
 * every storefront page can then assume a cart exists, and the token cookie is
 * issued on the first page view rather than on the first add-to-basket.
 */
const ShopLayout = async ({ children }: { children: React.ReactNode }) => {
  const [config, categoryTree, customer, identity] = await Promise.all([
    getStoreConfig(),
    getCategoryTree(),
    getCurrentCustomer(),
    resolveCartIdentity(),
  ]);

  const cart = await getCartView(identity);

  const categories: ShopNavCategory[] = categoryTree.slice(0, 8).map((node) => ({
    name: node.name,
    slug: node.slug,
    children: node.children.map((child) => ({ name: child.name, slug: child.slug })),
  }));

  return (
    <TooltipProvider>
      <div className="bg-canvas flex min-h-dvh flex-col">
        <ShopHeader
          storeName={config.name}
          categories={categories}
          initialCartCount={cart.itemCount}
          isSignedIn={customer !== null}
          customerFirstName={customer?.firstName ?? null}
        />

        {config.maintenanceMode ? (
          <div
            role="status"
            className="bg-warning-soft text-warning border-warning/30 border-b px-4 py-2 text-center text-sm"
          >
            This store is temporarily closed for maintenance. Browsing is available, but orders
            cannot be placed.
          </div>
        ) : null}

        <main id="main" className="flex-1">
          {children}
        </main>

        <footer className="border-line bg-surface mt-12 border-t">
          <div className="mx-auto w-full max-w-[90rem] px-4 py-10 sm:px-6">
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <h2 className="text-fg text-sm font-semibold">{config.name}</h2>
                {config.tagline ? (
                  <p className="text-fg-muted mt-2 text-sm leading-relaxed">{config.tagline}</p>
                ) : null}
              </div>

              <nav aria-labelledby="footer-shop">
                <h2 id="footer-shop" className="text-fg text-sm font-semibold">
                  Shop
                </h2>
                <ul className="mt-2 space-y-1.5">
                  {categories.slice(0, 5).map((category) => (
                    <li key={category.slug}>
                      <Link
                        href={`/c/${category.slug}`}
                        className="text-fg-muted hover:text-fg rounded text-sm"
                      >
                        {category.name}
                      </Link>
                    </li>
                  ))}
                  <li>
                    <Link href="/search" className="text-fg-muted hover:text-fg rounded text-sm">
                      All products
                    </Link>
                  </li>
                </ul>
              </nav>

              <nav aria-labelledby="footer-account">
                <h2 id="footer-account" className="text-fg text-sm font-semibold">
                  Your account
                </h2>
                <ul className="mt-2 space-y-1.5">
                  <li>
                    <Link
                      href={customer ? '/account' : '/account/login'}
                      className="text-fg-muted hover:text-fg rounded text-sm"
                    >
                      {customer ? 'Account overview' : 'Sign in'}
                    </Link>
                  </li>
                  <li>
                    <Link
                      href={customer ? '/account/orders' : '/account/register'}
                      className="text-fg-muted hover:text-fg rounded text-sm"
                    >
                      {customer ? 'Your orders' : 'Create an account'}
                    </Link>
                  </li>
                  <li>
                    <Link href="/cart" className="text-fg-muted hover:text-fg rounded text-sm">
                      Your basket
                    </Link>
                  </li>
                </ul>
              </nav>

              <div>
                <h2 className="text-fg text-sm font-semibold">Help</h2>
                <ul className="mt-2 space-y-1.5">
                  {config.supportEmail ? (
                    <li>
                      <a
                        href={`mailto:${config.supportEmail}`}
                        className="text-fg-muted hover:text-fg rounded text-sm break-all"
                      >
                        {config.supportEmail}
                      </a>
                    </li>
                  ) : null}
                  {config.supportPhone ? (
                    <li>
                      <a
                        href={`tel:${config.supportPhone.replace(/\s/g, '')}`}
                        className="text-fg-muted hover:text-fg rounded text-sm"
                      >
                        {config.supportPhone}
                      </a>
                    </li>
                  ) : null}
                  <li>
                    <Link href="/login" className="text-fg-subtle hover:text-fg rounded text-sm">
                      Staff sign-in
                    </Link>
                  </li>
                </ul>
              </div>
            </div>

            <div className="border-line text-fg-subtle mt-8 border-t pt-6 text-xs">
              <p>
                {new Date().getFullYear()} {config.name}. Prices shown in {config.currency}.
              </p>
              <p className="mt-1">
                This is a demonstration storefront. Catalogue content and prices are sample data.
              </p>
            </div>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
};

export default ShopLayout;
