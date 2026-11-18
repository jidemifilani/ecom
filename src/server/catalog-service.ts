import { NotFoundError, PreconditionFailedError } from '@/lib/api/errors';
import type { ListQuery } from '@/lib/api/query';
import type { Paginated } from '@/lib/api/responses';
import { diffSnapshots, recordAudit } from '@/lib/audit';
import { db, type DbClient } from '@/lib/db';
import { slugify } from '@/lib/utils';
import { ProductStatus } from '@/generated/prisma/enums';
import type {
  CreateBrandInput,
  CreateCategoryInput,
  UpdateBrandInput,
  UpdateCategoryInput,
} from '@/validation/catalog';

import { auditActorFor, type ServiceActor } from './types';

/**
 * Categories and brands.
 *
 * Slugs are derived from the name when not supplied and de-duplicated with a
 * numeric suffix, so saving two products called "Classic Tee" never fails with
 * a raw unique-constraint error.
 */

type SluggableDelegate = {
  findFirst: (args: {
    where: { slug: string; id?: { not: string } };
    select: { id: true };
  }) => Promise<{ id: string } | null>;
};

/** Finds a free slug, appending -2, -3 ... when the base is taken. */
export const uniqueSlug = async (
  delegate: SluggableDelegate,
  desired: string,
  excludeId?: string,
): Promise<string> => {
  const base = slugify(desired) || 'item';
  let candidate = base;

  for (let attempt = 2; attempt < 200; attempt += 1) {
    const clash = await delegate.findFirst({
      where: { slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
    candidate = `${base}-${attempt}`;
  }

  // Practically unreachable; keeps the function total rather than looping.
  return `${base}-${Date.now()}`;
};

// ── Categories ───────────────────────────────────────────────────────────────

export type CategoryListItem = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  parentName: string | null;
  position: number;
  isActive: boolean;
  imageUrl: string | null;
  productCount: number;
  childCount: number;
  createdAt: Date;
  deletedAt: Date | null;
};

export const listCategories = async (
  query: ListQuery<'position' | 'name' | 'createdAt'>,
): Promise<Paginated<CategoryListItem>> => {
  const where = {
    ...(query.includeArchived ? {} : { deletedAt: null }),
    ...(query.filters.isActive ? { isActive: query.filters.isActive === 'true' } : {}),
    ...(query.filters.parentId === 'root'
      ? { parentId: null }
      : query.filters.parentId
        ? { parentId: query.filters.parentId }
        : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' as const } },
            { slug: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.category.findMany({
      where,
      orderBy:
        query.sortBy === 'position'
          ? [{ position: query.sortOrder }, { name: 'asc' }]
          : { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
      select: {
        id: true,
        name: true,
        slug: true,
        parentId: true,
        position: true,
        isActive: true,
        imageUrl: true,
        createdAt: true,
        deletedAt: true,
        parent: { select: { name: true } },
        _count: { select: { products: true, children: true } },
      },
    }),
    db.category.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      parentId: row.parentId,
      parentName: row.parent?.name ?? null,
      position: row.position,
      isActive: row.isActive,
      imageUrl: row.imageUrl,
      productCount: row._count.products,
      childCount: row._count.children,
      createdAt: row.createdAt,
      deletedAt: row.deletedAt,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
};

export const getCategory = async (id: string) => {
  const category = await db.category.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      imageUrl: true,
      parentId: true,
      position: true,
      isActive: true,
      metaTitle: true,
      metaDescription: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { products: true, children: true } },
    },
  });
  if (!category) throw new NotFoundError('Category');
  return category;
};

/**
 * Walks up the parent chain to confirm `candidateParentId` is not the category
 * itself or one of its descendants, which would create an orphaned cycle.
 */
const assertNoCategoryCycle = async (
  categoryId: string,
  candidateParentId: string | null,
): Promise<void> => {
  if (!candidateParentId) return;
  if (candidateParentId === categoryId) {
    throw new PreconditionFailedError('A category cannot be its own parent.');
  }

  let cursor: string | null = candidateParentId;
  for (let depth = 0; depth < 50 && cursor; depth += 1) {
    const parent: { parentId: string | null } | null = await db.category.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    if (!parent) return;
    if (parent.parentId === categoryId) {
      throw new PreconditionFailedError(
        'That would place the category inside one of its own subcategories.',
      );
    }
    cursor = parent.parentId;
  }
};

export const createCategory = async (input: CreateCategoryInput, actor: ServiceActor) => {
  const slug = await uniqueSlug(db.category, input.slug ?? input.name);

  const category = await db.$transaction(async (tx) => {
    const created = await tx.category.create({
      data: {
        name: input.name,
        slug,
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
        parentId: input.parentId ?? null,
        position: input.position,
        isActive: input.isActive,
        metaTitle: input.metaTitle ?? null,
        metaDescription: input.metaDescription ?? null,
      },
      select: { id: true },
    });

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'CREATE',
        entityType: 'Category',
        entityId: created.id,
        entityLabel: input.name,
        after: { name: input.name, slug, isActive: input.isActive },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );

    return created;
  });

  return getCategory(category.id);
};

export const updateCategory = async (
  id: string,
  input: UpdateCategoryInput,
  actor: ServiceActor,
) => {
  const existing = await getCategory(id);
  await assertNoCategoryCycle(id, input.parentId ?? null);

  const slug =
    input.slug && input.slug !== existing.slug
      ? await uniqueSlug(db.category, input.slug, id)
      : existing.slug;

  const after = {
    name: input.name,
    slug,
    description: input.description ?? null,
    imageUrl: input.imageUrl ?? null,
    parentId: input.parentId ?? null,
    position: input.position,
    isActive: input.isActive,
    metaTitle: input.metaTitle ?? null,
    metaDescription: input.metaDescription ?? null,
  };

  await db.$transaction(async (tx) => {
    await tx.category.update({ where: { id }, data: after });

    const diff = diffSnapshots(
      {
        name: existing.name,
        slug: existing.slug,
        description: existing.description,
        imageUrl: existing.imageUrl,
        parentId: existing.parentId,
        position: existing.position,
        isActive: existing.isActive,
        metaTitle: existing.metaTitle,
        metaDescription: existing.metaDescription,
      },
      after,
    );

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'UPDATE',
        entityType: 'Category',
        entityId: id,
        entityLabel: input.name,
        before: diff.before,
        after: diff.after,
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );
  });

  return getCategory(id);
};

export const archiveCategory = async (id: string, actor: ServiceActor): Promise<void> => {
  const category = await getCategory(id);

  if (category._count.children > 0) {
    throw new PreconditionFailedError(
      `"${category.name}" still has ${category._count.children} subcategory(ies). Move or archive those first.`,
    );
  }

  await db.$transaction(async (tx) => {
    await tx.category.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    // Products keep their reference but the category no longer lists publicly;
    // detaching them would silently lose merchandising work.
    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'ARCHIVE',
        entityType: 'Category',
        entityId: id,
        entityLabel: category.name,
        before: { deletedAt: null, isActive: category.isActive },
        after: { deletedAt: new Date(), isActive: false },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );
  });
};

export type CategoryTreeNode = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  /** Products in this category. */
  productCount: number;
  /** Products in this category and everything beneath it. */
  totalProductCount: number;
  children: CategoryTreeNode[];
};

/** The active category tree, used by the storefront navigation. */
export const getCategoryTree = async (client: DbClient = db): Promise<CategoryTreeNode[]> => {
  const rows = await client.category.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      imageUrl: true,
      parentId: true,
      // Only count products a shopper can actually buy.
      _count: {
        select: { products: { where: { deletedAt: null, status: ProductStatus.ACTIVE } } },
      },
    },
  });

  const nodes = new Map<string, CategoryTreeNode & { parentId: string | null }>();
  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      name: row.name,
      slug: row.slug,
      imageUrl: row.imageUrl,
      productCount: row._count.products,
      totalProductCount: row._count.products,
      parentId: row.parentId,
      children: [],
    });
  }

  const roots: CategoryTreeNode[] = [];
  for (const node of nodes.values()) {
    if (node.parentId) {
      const parent = nodes.get(node.parentId);
      if (parent) {
        parent.children.push(node);
        continue;
      }
    }
    roots.push(node);
  }

  /*
   * Roll descendant counts up. A top-level category such as "Audio" usually
   * holds no products directly -- they sit in "Headphones" and "Speakers" --
   * so showing its own count alone would advertise "0 items" on a category
   * that has plenty. The storefront listing already includes child categories,
   * so the count must match what the shopper will actually see.
   */
  const rollUp = (node: CategoryTreeNode): number => {
    node.totalProductCount =
      node.productCount + node.children.reduce((sum, child) => sum + rollUp(child), 0);
    return node.totalProductCount;
  };

  for (const root of roots) rollUp(root);

  return roots;
};

/** Flat list for select inputs. */
export const listCategoryOptions = async (): Promise<
  { id: string; name: string; depth: number }[]
> => {
  const tree = await getCategoryTree();
  const flat: { id: string; name: string; depth: number }[] = [];

  const walk = (nodes: CategoryTreeNode[], depth: number): void => {
    for (const node of nodes) {
      flat.push({ id: node.id, name: node.name, depth });
      walk(node.children, depth + 1);
    }
  };

  walk(tree, 0);
  return flat;
};

// ── Brands ───────────────────────────────────────────────────────────────────

export type BrandListItem = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  isActive: boolean;
  productCount: number;
  createdAt: Date;
  deletedAt: Date | null;
};

export const listBrands = async (
  query: ListQuery<'name' | 'createdAt'>,
): Promise<Paginated<BrandListItem>> => {
  const where = {
    ...(query.includeArchived ? {} : { deletedAt: null }),
    ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
  };

  const [rows, total] = await Promise.all([
    db.brand.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        isActive: true,
        createdAt: true,
        deletedAt: true,
        _count: { select: { products: true } },
      },
    }),
    db.brand.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      logoUrl: row.logoUrl,
      isActive: row.isActive,
      productCount: row._count.products,
      createdAt: row.createdAt,
      deletedAt: row.deletedAt,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
};

export const createBrand = async (input: CreateBrandInput, actor: ServiceActor) => {
  const slug = await uniqueSlug(db.brand, input.slug ?? input.name);

  const brand = await db.brand.create({
    data: {
      name: input.name,
      slug,
      logoUrl: input.logoUrl ?? null,
      isActive: input.isActive,
    },
    select: { id: true, name: true, slug: true, logoUrl: true, isActive: true },
  });

  await recordAudit({
    actor: auditActorFor(actor),
    action: 'CREATE',
    entityType: 'Brand',
    entityId: brand.id,
    entityLabel: brand.name,
    after: { name: brand.name, slug: brand.slug },
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    requestId: actor.requestId ?? null,
  });

  return brand;
};

export const updateBrand = async (id: string, input: UpdateBrandInput, actor: ServiceActor) => {
  const existing = await db.brand.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true, slug: true, logoUrl: true, isActive: true },
  });
  if (!existing) throw new NotFoundError('Brand');

  const slug =
    input.slug && input.slug !== existing.slug
      ? await uniqueSlug(db.brand, input.slug, id)
      : existing.slug;

  const after = {
    name: input.name,
    slug,
    logoUrl: input.logoUrl ?? null,
    isActive: input.isActive,
  };

  const brand = await db.brand.update({
    where: { id },
    data: after,
    select: { id: true, name: true, slug: true, logoUrl: true, isActive: true },
  });

  const diff = diffSnapshots(existing, { id: existing.id, ...after });
  await recordAudit({
    actor: auditActorFor(actor),
    action: 'UPDATE',
    entityType: 'Brand',
    entityId: id,
    entityLabel: input.name,
    before: diff.before,
    after: diff.after,
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    requestId: actor.requestId ?? null,
  });

  return brand;
};

export const archiveBrand = async (id: string, actor: ServiceActor): Promise<void> => {
  const brand = await db.brand.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!brand) throw new NotFoundError('Brand');

  await db.brand.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });

  await recordAudit({
    actor: auditActorFor(actor),
    action: 'ARCHIVE',
    entityType: 'Brand',
    entityId: id,
    entityLabel: brand.name,
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    requestId: actor.requestId ?? null,
  });
};

export const listBrandOptions = async (): Promise<{ id: string; name: string }[]> =>
  db.brand.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
    take: 500,
  });
