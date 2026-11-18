import { collectionRoute } from '@/lib/api/crud';
import { createProduct, listProducts } from '@/server/product-service';
import { createProductSchema, PRODUCT_SORT_FIELDS } from '@/validation/catalog';

/** /api/v1/products -- list and create catalogue products. */
export const { GET, POST } = collectionRoute({
  list: {
    permission: 'product.read',
    sortable: PRODUCT_SORT_FIELDS,
    defaultSort: 'createdAt',
    filterKeys: ['status', 'categoryId', 'brandId', 'isFeatured'],
    run: (query) => listProducts(query),
  },
  create: {
    permission: 'product.create',
    schema: createProductSchema,
    run: (input, actor) => createProduct(input, actor),
  },
});
