import type { Metadata } from 'next';

import { PageHeader } from '@/components/ui/card';
import { Breadcrumbs } from '@/components/ui/navigation';
import { requirePermission } from '@/lib/auth/current-user';

import { CustomerForm } from '../customer-form';

export const metadata: Metadata = { title: 'New customer' };

const NewCustomerPage = async () => {
  await requirePermission('customer.create');

  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Customers', href: '/customers' }, { label: 'New customer' }]}
      />

      <PageHeader
        title="New customer"
        description="Create a customer record for a phone or counter sale. They can claim the account later by registering with the same email."
      />

      <div className="max-w-3xl">
        <CustomerForm mode="create" canDelete={false} />
      </div>
    </>
  );
};

export default NewCustomerPage;
