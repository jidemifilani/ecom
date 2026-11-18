import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth/current-user';
import { isEntraEnabled } from '@/lib/auth/entra';

import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

/**
 * /login
 *
 * Middleware already bounces a request carrying a session cookie, but this
 * checks the session for real (the cookie could be stale or revoked) and so is
 * the authoritative guard.
 *
 * `next` is validated to be a relative path, so the parameter cannot be used
 * to redirect a signed-in user to another origin.
 */
const LoginPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) => {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);

  if (user) redirect('/dashboard');

  const requested = params.next ?? '/dashboard';
  const nextPath =
    requested.startsWith('/') && !requested.startsWith('//') ? requested : '/dashboard';

  return (
    <LoginForm
      entraEnabled={isEntraEnabled()}
      nextPath={nextPath}
      ssoError={params.error}
    />
  );
};

export default LoginPage;
