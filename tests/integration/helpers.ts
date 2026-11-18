import { hashPassword } from '@/lib/auth/password';
import { db } from '@/lib/db';
import {
  ALL_PERMISSION_KEYS,
  PERMISSIONS,
  ROLE_PRESETS,
  resolvePresetPermissions,
  splitPermission,
  type PermissionKey,
} from '@/lib/rbac/permissions';
import { ProductStatus, UserStatus } from '@/generated/prisma/enums';
import type { ServiceActor } from '@/server/types';

/**
 * Fixtures for the integration suite.
 *
 * Each helper creates the minimum needed for one scenario and returns real
 * database ids, so tests exercise the same code paths as the application
 * rather than a mocked substitute.
 */

/** Seeds the permission catalogue and the built-in roles. */
export const seedAccessControl = async (): Promise<Map<string, string>> => {
  for (const key of ALL_PERMISSION_KEYS) {
    const { resource, action } = splitPermission(key);
    await db.permission.upsert({
      where: { key },
      create: { key, resource, action, group: PERMISSIONS[key].group },
      update: {},
    });
  }

  const permissionIds = new Map(
    (await db.permission.findMany({ select: { id: true, key: true } })).map((row) => [
      row.key,
      row.id,
    ]),
  );

  const roleIds = new Map<string, string>();

  for (const preset of ROLE_PRESETS) {
    const role = await db.role.upsert({
      where: { key: preset.key },
      create: {
        key: preset.key,
        name: preset.name,
        description: preset.description,
        level: preset.level,
        isSystem: preset.isSystem,
      },
      update: { level: preset.level, deletedAt: null },
      select: { id: true },
    });

    roleIds.set(preset.key, role.id);

    const wanted = resolvePresetPermissions(preset)
      .map((key) => permissionIds.get(key))
      .filter((id): id is string => typeof id === 'string');

    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    await db.rolePermission.createMany({
      data: wanted.map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }

  return roleIds;
};

export type TestUser = {
  id: string;
  email: string;
  actor: ServiceActor;
};

/** Creates a staff user holding one built-in role, plus the matching actor. */
export const createStaffUser = async (
  roleKey: 'super_admin' | 'admin' | 'manager' | 'staff',
  overrides: { email?: string; password?: string } = {},
): Promise<TestUser> => {
  const preset = ROLE_PRESETS.find((role) => role.key === roleKey);
  if (!preset) throw new Error(`Unknown role preset: ${roleKey}`);

  const role = await db.role.findUniqueOrThrow({
    where: { key: roleKey },
    select: { id: true, level: true },
  });

  const email = overrides.email ?? `${roleKey}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;

  const user = await db.user.create({
    data: {
      email,
      firstName: 'Test',
      lastName: roleKey,
      status: UserStatus.ACTIVE,
      passwordHash: overrides.password ? await hashPassword(overrides.password) : null,
      passwordSetAt: overrides.password ? new Date() : null,
      roles: { create: { roleId: role.id } },
    },
    select: { id: true, email: true },
  });

  const permissions = resolvePresetPermissions(preset) as PermissionKey[];

  return {
    id: user.id,
    email: user.email,
    actor: {
      id: user.id,
      email: user.email,
      permissions: new Set(permissions),
      roleKeys: [roleKey],
      level: role.level,
      ipAddress: '203.0.113.9',
      userAgent: 'integration-test',
    },
  };
};

/** Seeds the settings the services read, with explicit test values. */
export const seedSettings = async (
  overrides: Record<string, string | number | boolean> = {},
): Promise<void> => {
  const values: Record<string, string | number | boolean> = {
    'store.name': 'Test Store',
    'store.currency': 'USD',
    'store.locale': 'en-US',
    'store.maintenanceMode': false,
    'checkout.allowGuest': true,
    'checkout.taxRateBps': 0,
    'checkout.taxInclusivePricing': false,
    'checkout.flatShippingMinor': 0,
    'checkout.freeShippingThresholdMinor': 0,
    'checkout.orderNumberPrefix': 'ORD',
    'inventory.lowStockThreshold': 5,
    'inventory.allowOversell': false,
    'inventory.reserveOnOrder': true,
    'catalog.productsPerPage': 12,
    'catalog.requireReviewApproval': true,
    'catalog.showOutOfStock': true,
    ...overrides,
  };

  for (const [key, value] of Object.entries(values)) {
    const type =
      typeof value === 'boolean' ? 'BOOLEAN' : typeof value === 'number' ? 'NUMBER' : 'STRING';

    await db.setting.upsert({
      where: { key },
      create: { key, group: 'Test', label: key, type, value },
      update: { value },
    });
  }
};

export type TestProduct = {
  productId: string;
  variantId: string;
  sku: string;
  price: number;
};

/** Creates an active product with one variant and a known stock level. */
export const createProduct = async (options: {
  name: string;
  price: number;
  quantity: number;
  sku?: string;
  categoryId?: string;
  allowBackorder?: boolean;
}): Promise<TestProduct> => {
  const sku =
    options.sku ?? `SKU-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  const slug = `${options.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;

  const product = await db.product.create({
    data: {
      name: options.name,
      slug,
      status: ProductStatus.ACTIVE,
      basePrice: options.price,
      currency: 'USD',
      publishedAt: new Date(),
      ...(options.categoryId ? { categoryId: options.categoryId } : {}),
      variants: {
        create: {
          sku,
          name: 'Default',
          price: options.price,
          isDefault: true,
          isActive: true,
        },
      },
    },
    select: { id: true, variants: { select: { id: true } } },
  });

  const variantId = product.variants[0]?.id;
  if (!variantId) throw new Error('Variant was not created');

  await db.inventoryItem.create({
    data: {
      variantId,
      quantityOnHand: options.quantity,
      reorderPoint: 5,
      allowBackorder: options.allowBackorder ?? false,
    },
  });

  return { productId: product.id, variantId, sku, price: options.price };
};

export const createCategory = async (name: string): Promise<string> => {
  const category = await db.category.create({
    data: {
      name,
      slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).slice(2, 7)}`,
      isActive: true,
    },
    select: { id: true },
  });
  return category.id;
};

export const createCustomer = async (
  email?: string,
): Promise<{ id: string; email: string }> => {
  const address = email ?? `customer.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;

  return db.customer.create({
    data: { email: address, firstName: 'Test', lastName: 'Customer' },
    select: { id: true, email: true },
  });
};

/** Current stock figures for a variant. */
export const stockOf = async (
  variantId: string,
): Promise<{ onHand: number; reserved: number; available: number }> => {
  const item = await db.inventoryItem.findUniqueOrThrow({
    where: { variantId },
    select: { quantityOnHand: true, quantityReserved: true },
  });

  return {
    onHand: item.quantityOnHand,
    reserved: item.quantityReserved,
    available: item.quantityOnHand - item.quantityReserved,
  };
};
