import { collectionRoute } from '@/lib/api/crud';
import { createCustomer, listCustomers } from '@/server/customer-service';
import { createCustomerSchema, CUSTOMER_SORT_FIELDS } from '@/validation/customer';

/** /api/v1/customers -- list and create customers. */
export const { GET, POST } = collectionRoute({
  list: {
    permission: 'customer.read',
    sortable: CUSTOMER_SORT_FIELDS,
    defaultSort: 'createdAt',
    filterKeys: ['status', 'marketingOptIn'],
    run: (query) => listCustomers(query),
  },
  create: {
    permission: 'customer.create',
    schema: createCustomerSchema,
    run: (input, actor) => createCustomer(input, actor),
  },
});
