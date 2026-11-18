import { collectionRoute } from '@/lib/api/crud';
import { createBrand, listBrands } from '@/server/catalog-service';
import { createBrandSchema } from '@/validation/catalog';

/** /api/v1/brands -- list and create brands. */
export const { GET, POST } = collectionRoute({
  list: {
    permission: 'brand.read',
    sortable: ['name', 'createdAt'] as const,
    defaultSort: 'name',
    defaultSortOrder: 'asc',
    run: (query) => listBrands(query),
  },
  create: {
    permission: 'brand.create',
    schema: createBrandSchema,
    run: (input, actor) => createBrand(input, actor),
  },
});
