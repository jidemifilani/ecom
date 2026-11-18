import { collectionRoute } from '@/lib/api/crud';
import { CATEGORY_SORT_FIELDS, createCategorySchema } from '@/validation/catalog';
import { createCategory, listCategories } from '@/server/catalog-service';

/** /api/v1/categories -- list and create categories. */
export const { GET, POST } = collectionRoute({
  list: {
    permission: 'category.read',
    sortable: CATEGORY_SORT_FIELDS,
    defaultSort: 'position',
    defaultSortOrder: 'asc',
    filterKeys: ['isActive', 'parentId'],
    run: (query) => listCategories(query),
  },
  create: {
    permission: 'category.create',
    schema: createCategorySchema,
    run: (input, actor) => createCategory(input, actor),
  },
});
