import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PageHeader, StatCard } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/feedback';
import { Breadcrumbs } from '@/components/ui/navigation';
import { NotFoundError } from '@/lib/api/errors';
import { requirePermission } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/guard';
import { formatNumber } from '@/lib/utils';
import { listCategoryOptions } from '@/server/catalog-service';
import { getDiscount } from '@/server/discount-service';
import { listProductOptions } from '@/server/product-service';
import { getStoreConfig } from '@/server/settings-service';

import { DiscountForm } from '../discount-form';

export const metadata: Metadata = { title: 'Discount' };

const DiscountDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const [viewer, { id }] = await Promise.all([requirePermission('discount.read'), params]);

  const discount = await getDiscount(id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const [categories, products, config] = await Promise.all([
    listCategoryOptions(),
    listProductOptions(),
    getStoreConfig(),
  ]);

  const canEdit = can(viewer, 'discount.update');

  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Discounts', href: '/discounts' }, { label: discount.code }]}
      />

      <PageHeader
        title={discount.code}
        description={discount.name}
        actions={<StatusBadge status={discount.deletedAt ? 'ARCHIVED' : discount.status} />}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Times used"
          value={formatNumber(discount.usageCount)}
          comparisonLabel={
            discount.usageLimit
              ? `of ${formatNumber(discount.usageLimit)} allowed`
              : 'no limit set'
          }
        />
        <StatCard label="Redemptions recorded" value={formatNumber(discount._count.redemptions)} />
        <StatCard
          label="Remaining uses"
          value={
            discount.usageLimit
              ? formatNumber(Math.max(0, discount.usageLimit - discount.usageCount))
              : 'Unlimited'
          }
        />
      </div>

      <div className="max-w-4xl">
        {canEdit ? (
          <DiscountForm
            mode="edit"
            currency={config.currency}
            categories={categories.map((category) => ({
              id: category.id,
              name: category.name,
            }))}
            products={products}
            canDelete={can(viewer, 'discount.delete')}
            initial={{
              id: discount.id,
              code: discount.code,
              name: discount.name,
              description: discount.description,
              type: discount.type,
              scope: discount.scope,
              value: discount.value,
              minSubtotal: discount.minSubtotal,
              maxDiscountAmount: discount.maxDiscountAmount,
              usageLimit: discount.usageLimit,
              usageCount: discount.usageCount,
              perCustomerLimit: discount.perCustomerLimit,
              startsAt: discount.startsAt ? discount.startsAt.toISOString() : null,
              endsAt: discount.endsAt ? discount.endsAt.toISOString() : null,
              isActive: discount.isActive,
              targetCategoryId: discount.targetCategoryId,
              targetProductId: discount.targetProductId,
              isArchived: discount.deletedAt !== null,
            }}
          />
        ) : (
          <div className="rounded-card border-line bg-surface border p-5">
            <p className="text-fg-muted text-sm">
              You have read-only access to discounts. Editing requires the &quot;Edit discount
              codes&quot; permission.
            </p>
          </div>
        )}
      </div>
    </>
  );
};

export default DiscountDetailPage;
