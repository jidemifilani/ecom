import { NotFoundError, PreconditionFailedError } from '@/lib/api/errors';
import type { ListQuery } from '@/lib/api/query';
import type { Paginated } from '@/lib/api/responses';
import { recordAudit } from '@/lib/audit';
import { db } from '@/lib/db';
import { notifyPermissionHolders } from '@/lib/notifications';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ReviewStatus } from '@/generated/prisma/enums';
import type { CreateReviewInput, ModerateReviewInput } from '@/validation/catalog';

import { getStoreConfig } from './settings-service';
import { auditActorFor, type ServiceActor } from './types';

/** Product reviews, with optional moderation. */

export type ReviewListItem = {
  id: string;
  productId: string;
  productName: string;
  authorName: string;
  rating: number;
  title: string | null;
  body: string;
  status: ReviewStatus;
  customerId: string | null;
  createdAt: Date;
  moderatedAt: Date | null;
};

export const listReviews = async (
  query: ListQuery<'createdAt' | 'rating'>,
): Promise<Paginated<ReviewListItem>> => {
  const where = {
    ...(query.filters.status ? { status: query.filters.status as ReviewStatus } : {}),
    ...(query.filters.productId ? { productId: query.filters.productId } : {}),
    ...(query.search
      ? {
          OR: [
            { authorName: { contains: query.search, mode: 'insensitive' as const } },
            { title: { contains: query.search, mode: 'insensitive' as const } },
            { body: { contains: query.search, mode: 'insensitive' as const } },
            { product: { name: { contains: query.search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.review.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
      select: {
        id: true,
        productId: true,
        authorName: true,
        rating: true,
        title: true,
        body: true,
        status: true,
        customerId: true,
        createdAt: true,
        moderatedAt: true,
        product: { select: { name: true } },
      },
    }),
    db.review.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      productName: row.product.name,
      authorName: row.authorName,
      rating: row.rating,
      title: row.title,
      body: row.body,
      status: row.status,
      customerId: row.customerId,
      createdAt: row.createdAt,
      moderatedAt: row.moderatedAt,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
};

/** Approved reviews for a product page. */
export const listProductReviews = async (
  productId: string,
  limit = 20,
): Promise<ReviewListItem[]> => {
  const rows = await db.review.findMany({
    where: { productId, status: ReviewStatus.APPROVED },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      productId: true,
      authorName: true,
      rating: true,
      title: true,
      body: true,
      status: true,
      customerId: true,
      createdAt: true,
      moderatedAt: true,
      product: { select: { name: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    productId: row.productId,
    productName: row.product.name,
    authorName: row.authorName,
    rating: row.rating,
    title: row.title,
    body: row.body,
    status: row.status,
    customerId: row.customerId,
    createdAt: row.createdAt,
    moderatedAt: row.moderatedAt,
  }));
};

export const submitReview = async (
  input: CreateReviewInput,
  options: {
    customerId?: string | undefined;
    ipAddress?: string | undefined;
  },
): Promise<{ id: string; status: ReviewStatus }> => {
  await enforceRateLimit('review-submit', options.customerId ?? options.ipAddress ?? 'anonymous');

  const product = await db.product.findFirst({
    where: { id: input.productId, deletedAt: null, status: 'ACTIVE' },
    select: { id: true, name: true },
  });
  if (!product) throw new NotFoundError('Product');

  // One review per customer per product keeps the average meaningful.
  if (options.customerId) {
    const existing = await db.review.findFirst({
      where: { productId: input.productId, customerId: options.customerId },
      select: { id: true },
    });
    if (existing) {
      throw new PreconditionFailedError('You have already reviewed this product.');
    }
  }

  const config = await getStoreConfig();
  const status = config.requireReviewApproval ? ReviewStatus.PENDING : ReviewStatus.APPROVED;

  const review = await db.review.create({
    data: {
      productId: input.productId,
      customerId: options.customerId ?? null,
      authorName: input.authorName,
      rating: input.rating,
      title: input.title ?? null,
      body: input.body,
      status,
      moderatedAt: status === ReviewStatus.APPROVED ? new Date() : null,
    },
    select: { id: true, status: true },
  });

  if (status === ReviewStatus.PENDING) {
    await notifyPermissionHolders('review.moderate', {
      type: 'review.pending',
      title: 'Review awaiting approval',
      body: `${input.rating}-star review of ${product.name} from ${input.authorName}.`,
      entityType: 'Review',
      entityId: review.id,
      actionUrl: '/catalog/reviews',
    });
  }

  return review;
};

export const moderateReview = async (
  id: string,
  input: ModerateReviewInput,
  actor: ServiceActor,
) => {
  const review = await db.review.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      authorName: true,
      rating: true,
      product: { select: { name: true } },
    },
  });
  if (!review) throw new NotFoundError('Review');

  const updated = await db.review.update({
    where: { id },
    data: { status: input.status, moderatedAt: new Date() },
    select: { id: true, status: true },
  });

  await recordAudit({
    actor: auditActorFor(actor),
    action: 'REVIEW_MODERATED',
    entityType: 'Review',
    entityId: id,
    entityLabel: `${review.rating}-star review of ${review.product.name}`,
    before: { status: review.status },
    after: { status: input.status },
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    requestId: actor.requestId ?? null,
  });

  return updated;
};

export const countPendingReviews = async (): Promise<number> =>
  db.review.count({ where: { status: ReviewStatus.PENDING } });
