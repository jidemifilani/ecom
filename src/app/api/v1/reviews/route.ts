import { collectionRoute } from '@/lib/api/crud';
import { listReviews } from '@/server/review-service';

/** GET /api/v1/reviews -- moderation queue and review history. */
export const { GET } = collectionRoute({
  list: {
    permission: 'review.read',
    sortable: ['createdAt', 'rating'] as const,
    defaultSort: 'createdAt',
    filterKeys: ['status', 'productId'],
    run: (query) => listReviews(query),
  },
});
