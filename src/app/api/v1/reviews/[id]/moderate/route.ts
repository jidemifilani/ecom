import { actionRoute } from '@/lib/api/crud';
import { moderateReview } from '@/server/review-service';
import { moderateReviewSchema } from '@/validation/catalog';

/** PATCH /api/v1/reviews/[id]/moderate -- approve or reject a review. */
export const PATCH = actionRoute({
  permission: 'review.moderate',
  schema: moderateReviewSchema,
  run: (id, input, actor) => moderateReview(id, input, actor),
});

export const POST = PATCH;
