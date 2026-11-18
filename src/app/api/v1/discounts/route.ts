import { collectionRoute } from '@/lib/api/crud';
import { createDiscount, listDiscounts } from '@/server/discount-service';
import { createDiscountSchema, DISCOUNT_SORT_FIELDS } from '@/validation/discount';

/** /api/v1/discounts -- list and create discount codes. */
export const { GET, POST } = collectionRoute({
  list: {
    permission: 'discount.read',
    sortable: DISCOUNT_SORT_FIELDS,
    defaultSort: 'createdAt',
    filterKeys: ['type', 'isActive'],
    run: (query) => listDiscounts(query),
  },
  create: {
    permission: 'discount.create',
    schema: createDiscountSchema,
    run: (input, actor) => createDiscount(input, actor),
  },
});
