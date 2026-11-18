import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCurrentCustomer } from '@/lib/auth/current-user';

import { CustomerLoginForm } from '../account-forms';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

const CustomerLoginPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) => {
  const [customer, params] = await Promise.all([getCurrentCustomer(), searchParams]);

  if (customer) redirect('/account');

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 sm:px-6">
      <Card as="section">
        <CardHeader>
          <CardTitle as="h1">Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomerLoginForm next={params.next} />
        </CardContent>
      </Card>
    </div>
  );
};

export default CustomerLoginPage;
