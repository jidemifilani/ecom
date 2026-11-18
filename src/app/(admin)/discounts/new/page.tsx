import type { Metadata } from 'next';

import { PageHeader } from '@/components/ui/card';
import { Breadcrumbs } from '@/components/ui/navigation';
import { requirePermission } from '@/lib/auth/current-user';
import { listCategoryOptions } from '@/server/catalog-service';
import { listProductOptions } from '@/server/product-service';
import { getStoreConfig } from '@/server/settings-service';

import { DiscountForm } from '../discount-form';

export const metadata: Metadata = { title: 'New discount' };

const NewDiscountPage = async () => {
  await requirePermission('discount.create');

  const [categories, products, config] = await Promise.all([
    listCategoryOptions(),
    listProductOptions(),
    getStoreConfig(),
  ]);

  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Discounts', href: '/discounts' }, { label: 'New discount' }]}
      />

      <PageHeader
        title="New discount"
        description="Create a promotion code. Limits and dates are enforced at checkout, not just displayed here."
      />

      <div className="max-w-4xl">
        <DiscountForm
          mode="create"
          currency={config.currency}
          categories={categories.map((category) => ({ id: category.id, name: category.name }))}
          products={products}
          canDelete={false}
        />
      </div>
    </>
  );
};

export default NewDiscountPage;
