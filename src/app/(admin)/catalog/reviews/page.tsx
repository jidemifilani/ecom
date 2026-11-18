import type { Metadata } from 'next';
import Link from 'next/link';
import { Star } from 'lucide-react';

import { DataTable, type Column } from '@/components/data/data-table';
import { FilterBar } from '@/components/data/filter-bar';
import { PageHeader } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/feedback';
import { Breadcrumbs, LinkTabs } from '@/components/ui/navigation';
import { requirePermission } from '@/lib/auth/current-user';
import { safeListQuery } from '@/lib/list-query';
import { can } from '@/lib/rbac/guard';
import { hasActiveFilters, toSearchParams, urlBuilder } from '@/lib/url';
import { formatDateTime, truncate } from '@/lib/utils';
import {
  countPendingReviews,
  listReviews,
  type ReviewListItem,
} from '@/server/review-service';

import { RatingStars, ReviewModerationActions } from './review-actions';

export const metadata: Metadata = { title: 'Reviews' };

const FILTER_KEYS = ['status', 'productId'] as const;

const ReviewsPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const [viewer, rawParams] = await Promise.all([
    requirePermission('review.read'),
    searchParams,
  ]);

  const params = toSearchParams(rawParams);
  const buildHref = urlBuilder('/catalog/reviews', params);

  const query = safeListQuery(params, {
    sortable: ['createdAt', 'rating'] as const,
    defaultSort: 'createdAt',
    filterKeys: FILTER_KEYS,
  });

  const [result, pendingCount] = await Promise.all([
    listReviews(query),
    countPendingReviews(),
  ]);

  const canModerate = can(viewer, 'review.moderate');
  const activeStatus = params.get('status') ?? '';

  const columns: Column<ReviewListItem>[] = [
    {
      key: 'review',
      header: 'Review',
      mobile: 'title',
      className: 'max-w-md',
      render: (row) => (
        <span className="min-w-0">
          {row.title ? (
            <span className="text-fg block truncate font-medium">{row.title}</span>
          ) : null}
          <span className="text-fg-muted block text-sm leading-relaxed">
            {truncate(row.body, 160)}
          </span>
        </span>
      ),
    },
    {
      key: 'product',
      header: 'Product',
      mobile: 'subtitle',
      render: (row) =>
        can(viewer, 'product.read') ? (
          <Link
            href={`/catalog/products/${row.productId}`}
            className="text-accent rounded underline-offset-4 hover:underline"
          >
            {row.productName}
          </Link>
        ) : (
          row.productName
        ),
    },
    {
      key: 'rating',
      header: 'Rating',
      sortField: 'rating',
      mobile: 'field',
      render: (row) => <RatingStars rating={row.rating} />,
    },
    {
      key: 'author',
      header: 'Author',
      mobile: 'field',
      render: (row) => (
        <span className="min-w-0">
          <span className="text-fg block truncate">{row.authorName}</span>
          {row.customerId ? (
            <Badge tone="outline" className="mt-0.5">
              Verified account
            </Badge>
          ) : (
            <span className="text-fg-subtle text-xs">Guest</span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      mobile: 'badge',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'createdAt',
      header: 'Submitted',
      sortField: 'createdAt',
      mobile: 'field',
      render: (row) => formatDateTime(row.createdAt),
    },
  ];

  return (
    <>
      <Breadcrumbs items={[{ label: 'Catalog' }, { label: 'Reviews' }]} />

      <PageHeader
        title="Reviews"
        description="Moderate what shoppers see on product pages. Whether new reviews need approval is a store setting."
      />

      <LinkTabs
        items={[
          {
            label: 'Awaiting approval',
            href: '/catalog/reviews?status=PENDING',
            active: activeStatus === 'PENDING',
            count: pendingCount,
          },
          {
            label: 'Published',
            href: '/catalog/reviews?status=APPROVED',
            active: activeStatus === 'APPROVED',
          },
          {
            label: 'Rejected',
            href: '/catalog/reviews?status=REJECTED',
            active: activeStatus === 'REJECTED',
          },
          { label: 'All', href: '/catalog/reviews', active: activeStatus === '' },
        ]}
      />

      <FilterBar searchPlaceholder="Search review text, author or product" />

      <DataTable
        rows={result.items}
        columns={columns}
        getRowId={(row) => row.id}
        caption="Product reviews with rating, author and moderation status"
        sortBy={query.sortBy}
        sortOrder={query.sortOrder}
        buildSortHref={(field, order) => buildHref({ sortBy: field, sortOrder: order })}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        buildPageHref={(page) => buildHref({ page })}
        itemLabel="review"
        emptyIcon={Star}
        emptyTitle={activeStatus === 'PENDING' ? 'Nothing to moderate' : 'No reviews yet'}
        emptyDescription={
          activeStatus === 'PENDING'
            ? 'Every submitted review has been dealt with.'
            : 'Reviews left by shoppers appear here for approval.'
        }
        filtersActive={hasActiveFilters(params, FILTER_KEYS)}
        clearFiltersHref="/catalog/reviews"
        rowActions={
          canModerate
            ? (row) => (
                <ReviewModerationActions
                  reviewId={row.id}
                  status={row.status}
                  authorName={row.authorName}
                />
              )
            : undefined
        }
      />
    </>
  );
};

export default ReviewsPage;
