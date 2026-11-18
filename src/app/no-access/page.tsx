import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getStoreConfig } from '@/server/settings-service';

export const metadata: Metadata = {
  title: 'No access yet',
  robots: { index: false, follow: false },
};

/**
 * /no-access
 *
 * Where a user lands when they are authenticated but hold no roles. This
 * happens on a first single-sign-on arrival: Entra ID provisions the account,
 * but it deliberately grants nothing until an administrator assigns a role.
 *
 * Without this page such a user would see an empty dashboard shell and assume
 * the application was broken.
 */
const NoAccessPage = async () => {
  const [user, config] = await Promise.all([getCurrentUser(), getStoreConfig()]);

  return (
    <div className="bg-canvas grid min-h-dvh place-items-center px-4 py-10">
      <main id="main" className="w-full max-w-md text-center">
        <span className="bg-warning-soft text-warning mx-auto mb-5 grid size-14 place-items-center rounded-full">
          <ShieldAlert className="size-7" aria-hidden="true" />
        </span>

        <h1 className="text-fg text-2xl font-semibold tracking-tight">
          Your account has no access yet
        </h1>

        <p className="text-fg-muted mt-3 text-sm leading-relaxed">
          {user ? (
            <>
              You are signed in as <span className="text-fg font-medium">{user.email}</span>, but
              no role has been assigned to your account. An administrator needs to grant you one
              before you can use the back office.
            </>
          ) : (
            'Sign in to continue.'
          )}
        </p>

        {config.supportEmail ? (
          <p className="text-fg-subtle mt-4 text-sm">
            Need access? Contact{' '}
            <a
              href={`mailto:${config.supportEmail}`}
              className="text-accent rounded font-medium underline-offset-4 hover:underline"
            >
              {config.supportEmail}
            </a>
            .
          </p>
        ) : null}

        <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button variant="outline" asChild>
            <Link href="/">Go to the storefront</Link>
          </Button>
          {user ? (
            <Button variant="ghost" asChild>
              <Link href="/profile">View your profile</Link>
            </Button>
          ) : (
            <Button asChild>
              <Link href="/login">Sign in</Link>
            </Button>
          )}
        </div>
      </main>
    </div>
  );
};

export default NoAccessPage;
