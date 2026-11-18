import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/feedback';
import { Breadcrumbs } from '@/components/ui/navigation';
import { NotFoundError } from '@/lib/api/errors';
import { requirePermission } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/guard';
import { listBrandOptions, listCategoryOptions } from '@/server/catalog-service';
import { getProduct } from '@/server/product-service';
import { getStoreConfig } from '@/server/settings-service';

import { ProductForm } from '../product-form';
import { VariantManager, type VariantRow } from './variant-manager';

export const metadata: Metadata = { title: 'Product' };

const ProductDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const [viewer, { id }] = await Promise.all([requirePermission('product.read'), params]);

  const product = await getProduct(id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const [categories, brands, config] = await Promise.all([
    listCategoryOptions(),
    listBrandOptions(),
    getStoreConfig(),
  ]);

  const canEdit = can(viewer, 'product.update');

  const variantRows: VariantRow[] = product.variants.map((variant) => ({
    id: variant.id,
    sku: variant.sku,
    name: variant.name,
    price: variant.price,
    isDefault: variant.isDefault,
    isActive: variant.isActive,
    quantityOnHand: variant.inventoryItem?.quantityOnHand ?? 0,
    quantityReserved: variant.inventoryItem?.quantityReserved ?? 0,
    reorderPoint: variant.inventoryItem?.reorderPoint ?? 0,
    options: variant.optionValues.map((entry) => ({
      name: entry.optionValue.option.name,
      value: entry.optionValue.value,
    })),
  }));

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Catalog' },
          { label: 'Products', href: '/catalog/products' },
          { label: product.name },
        ]}
      />

      <PageHeader
        title={product.name}
        description={product.shortDescription ?? 'No short description set.'}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={product.deletedAt ? 'ARCHIVED' : product.status} />
            {product.status === 'ACTIVE' && !product.deletedAt ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/p/${product.slug}`} target="_blank" rel="noopener">
                  <ExternalLink aria-hidden="true" />
                  View in store
                  <span className="sr-only"> (opens in a new tab)</span>
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />

      {canEdit ? (
        <ProductForm
          mode="edit"
          initial={{
            id: product.id,
            name: product.name,
            slug: product.slug,
            shortDescription: product.shortDescription,
            description: product.description,
            status: product.status,
            categoryId: product.categoryId,
            brandId: product.brandId,
            basePrice: product.basePrice,
            compareAtPrice: product.compareAtPrice,
            costPrice: product.costPrice,
            currency: product.currency,
            taxRateBps: product.taxRateBps,
            isFeatured: product.isFeatured,
            trackInventory: product.trackInventory,
            weightGrams: product.weightGrams,
            metaTitle: product.metaTitle,
            metaDescription: product.metaDescription,
            images: product.images.map((image) => ({
              url: image.url,
              alt: image.alt,
              isPrimary: image.isPrimary,
            })),
            isArchived: product.deletedAt !== null,
          }}
          categories={categories}
          brands={brands}
          defaultCurrency={config.currency}
          canDelete={can(viewer, 'product.delete')}
        />
      ) : (
        <div className="rounded-card border-line bg-surface border p-5">
          <p className="text-fg-muted text-sm">
            You have read-only access to the catalog. Editing requires the &quot;Edit
            products&quot; permission.
          </p>
        </div>
      )}

      <VariantManager
        productId={product.id}
        variants={variantRows}
        currency={product.currency}
        locale={config.locale}
        canEdit={canEdit}
      />
    </>
  );
};

export default ProductDetailPage;
