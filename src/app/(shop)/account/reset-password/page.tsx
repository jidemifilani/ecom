import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { publicConfig } from '@/lib/env';

import { CustomerResetPasswordForm } from '../account-forms';

export const metadata: Metadata = {
  title: 'Choose a new password',
  robots: { index: false, follow: false },
};

const CustomerResetPasswordPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) => {
  const { token } = await searchParams;

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 sm:px-6">
      <Card as="section">
        <CardHeader>
          <CardTitle as="h1">Choose a new password</CardTitle>
        </CardHeader>
        <CardContent>
          {token ? (
            <CustomerResetPasswordForm
              token={token}
              passwordMinLength={publicConfig.passwordMinLength}
            />
          ) : (
            <div className="space-y-4">
              <Alert tone="warning">
                This page needs the link from your reset email. Open the link again, or request a
                new one.
              </Alert>
              <Button block asChild>
                <Link href="/account/forgot-password">Request a new link</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CustomerResetPasswordPage;
