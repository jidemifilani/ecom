import { itemRoute } from '@/lib/api/crud';
import { archiveBrand, updateBrand } from '@/server/catalog-service';
import { updateBrandSchema } from '@/validation/catalog';

/** /api/v1/brands/[id] -- update or archive a brand. */
export const { PATCH, PUT, DELETE } = itemRoute({
  update: {
    permission: 'brand.update',
    schema: updateBrandSchema,
    run: (id, input, actor) => updateBrand(id, input, actor),
  },
  remove: { permission: 'brand.delete', run: (id, actor) => archiveBrand(id, actor) },
});
