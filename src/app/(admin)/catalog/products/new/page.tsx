import type { Metadata } from 'next';

import { PageHeader } from '@/components/ui/card';
import { Breadcrumbs } from '@/components/ui/navigation';
import { requirePermission } from '@/lib/auth/current-user';
import { listBrandOptions, listCategoryOptions } from '@/server/catalog-service';
import { getStoreConfig } from '@/server/settings-service';

import { ProductForm } from '../product-form';

export const metadata: Metadata = { title: 'New product' };

const NewProductPage = async () => {
  await requirePermission('product.create');

  const [categories, brands, config] = await Promise.all([
    listCategoryOptions(),
    listBrandOptions(),
    getStoreConfig(),
  ]);

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Catalog' },
          { label: 'Products', href: '/catalog/products' },
          { label: 'New product' },
        ]}
      />

      <PageHeader
        title="New product"
        description="Create the product and its default variant. Add more variants, such as sizes or colours, afterwards."
      />

      <ProductForm
        mode="create"
        categories={categories}
        brands={brands}
        defaultCurrency={config.currency}
        canDelete={false}
      />
    </>
  );
};

export default NewProductPage;
