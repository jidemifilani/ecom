import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCurrentCustomer } from '@/lib/auth/current-user';
import { publicConfig } from '@/lib/env';

import { CustomerRegisterForm } from '../account-forms';

export const metadata: Metadata = {
  title: 'Create an account',
  robots: { index: false, follow: false },
};

const RegisterPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) => {
  const [customer, params] = await Promise.all([getCurrentCustomer(), searchParams]);

  if (customer) redirect('/account');

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-10 sm:px-6">
      <Card as="section">
        <CardHeader>
          <CardTitle as="h1">Create an account</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-fg-muted mb-5 text-sm leading-relaxed">
            Track your orders and check out faster next time. If you have ordered as a guest with
            this email address, your history is kept.
          </p>
          <CustomerRegisterForm
            next={params.next}
            passwordMinLength={publicConfig.passwordMinLength}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default RegisterPage;
