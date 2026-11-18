import { withApi } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/query';
import { jsonCreated } from '@/lib/api/responses';
import { getCurrentCustomer } from '@/lib/auth/current-user';
import { readJsonBody } from '@/lib/request';
import { submitReview } from '@/server/review-service';
import { createReviewSchema } from '@/validation/catalog';

/**
 * POST /api/shop/reviews
 *
 * Accepts a product review. Whether it publishes immediately or waits for
 * moderation is a store setting, not a client choice. Rate limited per
 * customer or IP to keep the moderation queue usable.
 */
export const POST = withApi(async ({ request, client }) => {
  const customer = await getCurrentCustomer();
  const body = await readJsonBody(request);
  const input = parseBody(createReviewSchema, body);

  const review = await submitReview(input, {
    customerId: customer?.id,
    ipAddress: client.ipAddress,
  });

  return jsonCreated({
    id: review.id,
    status: review.status,
    message:
      review.status === 'PENDING'
        ? 'Thank you. Your review will appear once it has been checked.'
        : 'Thank you. Your review is now live.',
  });
});
