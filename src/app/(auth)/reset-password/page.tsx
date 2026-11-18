import type { Metadata } from 'next';
import Link from 'next/link';

import { Alert } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { publicConfig } from '@/lib/env';

import { ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = {
  title: 'Choose a new password',
  robots: { index: false, follow: false },
};

/**
 * /reset-password?token=...
 *
 * The token is only inspected when the form is submitted. Validating it here
 * would tell a visitor whether a token is live before they prove they can use
 * it, and it would consume nothing while leaking that signal.
 */
const ResetPasswordPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) => {
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="rounded-card border-line bg-surface shadow-card border p-6 sm:p-8">
        <h1 className="text-fg text-xl font-semibold tracking-tight">Reset link incomplete</h1>
        <Alert tone="warning" className="mt-5">
          This page needs the link from your reset email. Open the link again, or request a new
          one.
        </Alert>
        <Button variant="outline" block asChild className="mt-6">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  return <ResetPasswordForm token={token} minLength={publicConfig.passwordMinLength} />;
};

export default ResetPasswordPage;
