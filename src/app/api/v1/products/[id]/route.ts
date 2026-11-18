import { itemRoute } from '@/lib/api/crud';
import { archiveProduct, getProduct, updateProduct } from '@/server/product-service';
import { updateProductSchema } from '@/validation/catalog';

/**
 * /api/v1/products/[id]
 *
 * Archiving also removes the product from every active basket, so a shopper
 * cannot check out something that is no longer for sale.
 */
export const { GET, PATCH, PUT, DELETE } = itemRoute({
  get: { permission: 'product.read', run: (id) => getProduct(id) },
  update: {
    permission: 'product.update',
    schema: updateProductSchema,
    run: (id, input, actor) => updateProduct(id, input, actor),
  },
  remove: { permission: 'product.delete', run: (id, actor) => archiveProduct(id, actor) },
});
