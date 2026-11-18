import { itemRoute } from '@/lib/api/crud';
import { archiveCategory, getCategory, updateCategory } from '@/server/catalog-service';
import { updateCategorySchema } from '@/validation/catalog';

/**
 * /api/v1/categories/[id]
 *
 * Re-parenting is checked for cycles, and a category with subcategories cannot
 * be archived until those are moved.
 */
export const { GET, PATCH, PUT, DELETE } = itemRoute({
  get: { permission: 'category.read', run: (id) => getCategory(id) },
  update: {
    permission: 'category.update',
    schema: updateCategorySchema,
    run: (id, input, actor) => updateCategory(id, input, actor),
  },
  remove: { permission: 'category.delete', run: (id, actor) => archiveCategory(id, actor) },
});
