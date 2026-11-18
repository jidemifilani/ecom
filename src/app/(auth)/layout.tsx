import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';

import { getStoreConfig } from '@/server/settings-service';

/**
 * Authentication layout.
 *
 * A single centred column that stays comfortable from 320px up. The card is
 * full-bleed on the smallest screens and gains a border and shadow once there
 * is room for one.
 */
const AuthLayout = async ({ children }: { children: React.ReactNode }) => {
  const config = await getStoreConfig();

  return (
    <div className="bg-canvas flex min-h-dvh flex-col">
      <header className="flex h-16 shrink-0 items-center px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label={`${config.name} home`}>
          <span
            aria-hidden="true"
            className="bg-primary text-on-primary grid size-8 place-items-center rounded-md"
          >
            <ShoppingBag className="size-4" />
          </span>
          <span className="text-fg text-sm font-semibold">{config.name}</span>
        </Link>
      </header>

      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-10 sm:items-center sm:px-6">
        <div className="w-full max-w-md">{children}</div>
      </main>

      <footer className="text-fg-subtle shrink-0 px-4 pb-6 text-center text-xs sm:px-6">
        <p>
          {config.supportEmail ? (
            <>
              Need help? <span className="text-fg-muted">{config.supportEmail}</span>
            </>
          ) : (
            'Back-office access is restricted to authorised staff.'
          )}
        </p>
      </footer>
    </div>
  );
};

export default AuthLayout;
