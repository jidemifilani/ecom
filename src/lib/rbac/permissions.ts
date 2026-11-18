/**
 * Permission catalogue - the single source of truth for authorization.
 *
 * Permissions are declared here, seeded into the `permissions` table, and
 * granted to roles through `role_permissions`. Roles and permissions are
 * deliberately separate so new roles can be composed later without code
 * changes: only *adding a new capability* requires touching this file.
 *
 * Naming: `<resource>.<action>`. Keys are stable forever once released -
 * rename the label, never the key.
 */

export type PermissionGroup =
  | 'Dashboard'
  | 'Access control'
  | 'Catalog'
  | 'Inventory'
  | 'Sales'
  | 'Customers'
  | 'Marketing'
  | 'Insights'
  | 'System';

type PermissionDefinition = {
  readonly group: PermissionGroup;
  readonly description: string;
};

export const PERMISSIONS = {
  // ── Dashboard ──────────────────────────────────────────────────────────────
  'dashboard.view': {
    group: 'Dashboard',
    description: 'See the dashboard and its KPI cards',
  },
  'dashboard.view_financials': {
    group: 'Dashboard',
    description: 'See revenue, margin and payout figures on the dashboard',
  },

  // ── Access control ─────────────────────────────────────────────────────────
  'user.read': { group: 'Access control', description: 'View staff users' },
  'user.create': { group: 'Access control', description: 'Invite new staff users' },
  'user.update': { group: 'Access control', description: 'Edit staff user details' },
  'user.delete': { group: 'Access control', description: 'Archive staff users' },
  'user.export': { group: 'Access control', description: 'Export the staff user list' },
  'user.assign_roles': {
    group: 'Access control',
    description: 'Grant or revoke roles on a staff user',
  },
  'user.reset_password': {
    group: 'Access control',
    description: "Force a password reset on another user's account",
  },
  'user.revoke_sessions': {
    group: 'Access control',
    description: 'Sign another user out of all devices',
  },
  'role.read': { group: 'Access control', description: 'View roles and their permissions' },
  'role.create': { group: 'Access control', description: 'Create new roles' },
  'role.update': { group: 'Access control', description: 'Edit roles and their permissions' },
  'role.delete': { group: 'Access control', description: 'Delete non-system roles' },

  // ── Catalog ────────────────────────────────────────────────────────────────
  'product.read': { group: 'Catalog', description: 'View products' },
  'product.create': { group: 'Catalog', description: 'Create products' },
  'product.update': { group: 'Catalog', description: 'Edit products, variants and media' },
  'product.delete': { group: 'Catalog', description: 'Archive products' },
  'product.export': { group: 'Catalog', description: 'Export the product catalogue' },
  'category.read': { group: 'Catalog', description: 'View categories' },
  'category.create': { group: 'Catalog', description: 'Create categories' },
  'category.update': { group: 'Catalog', description: 'Edit categories' },
  'category.delete': { group: 'Catalog', description: 'Archive categories' },
  'brand.read': { group: 'Catalog', description: 'View brands' },
  'brand.create': { group: 'Catalog', description: 'Create brands' },
  'brand.update': { group: 'Catalog', description: 'Edit brands' },
  'brand.delete': { group: 'Catalog', description: 'Archive brands' },
  'review.read': { group: 'Catalog', description: 'View product reviews' },
  'review.moderate': { group: 'Catalog', description: 'Approve or reject product reviews' },

  // ── Inventory ──────────────────────────────────────────────────────────────
  'inventory.read': { group: 'Inventory', description: 'View stock levels and movements' },
  'inventory.adjust': { group: 'Inventory', description: 'Adjust stock and record receipts' },
  'inventory.export': { group: 'Inventory', description: 'Export stock reports' },

  // ── Sales ──────────────────────────────────────────────────────────────────
  'order.read': { group: 'Sales', description: 'View orders' },
  'order.create': { group: 'Sales', description: 'Create orders on behalf of a customer' },
  'order.update': { group: 'Sales', description: 'Edit order details and notes' },
  'order.fulfill': { group: 'Sales', description: 'Create shipments and mark orders fulfilled' },
  'order.cancel': { group: 'Sales', description: 'Cancel orders' },
  'order.refund': { group: 'Sales', description: 'Issue refunds' },
  'order.delete': { group: 'Sales', description: 'Archive orders' },
  'order.export': { group: 'Sales', description: 'Export orders' },

  // ── Customers ──────────────────────────────────────────────────────────────
  'customer.read': { group: 'Customers', description: 'View customers' },
  'customer.create': { group: 'Customers', description: 'Create customers' },
  'customer.update': { group: 'Customers', description: 'Edit customers and addresses' },
  'customer.delete': { group: 'Customers', description: 'Archive customers' },
  'customer.export': { group: 'Customers', description: 'Export the customer list' },

  // ── Marketing ──────────────────────────────────────────────────────────────
  'discount.read': { group: 'Marketing', description: 'View discount codes' },
  'discount.create': { group: 'Marketing', description: 'Create discount codes' },
  'discount.update': { group: 'Marketing', description: 'Edit discount codes' },
  'discount.delete': { group: 'Marketing', description: 'Archive discount codes' },

  // ── Insights ───────────────────────────────────────────────────────────────
  'report.read': { group: 'Insights', description: 'View reports' },
  'report.export': { group: 'Insights', description: 'Export report data' },

  // ── System ─────────────────────────────────────────────────────────────────
  'audit_log.read': { group: 'System', description: 'Read the audit trail' },
  'audit_log.export': { group: 'System', description: 'Export the audit trail' },
  'setting.read': { group: 'System', description: 'View application settings' },
  'setting.update': { group: 'System', description: 'Change application settings' },
} as const satisfies Record<string, PermissionDefinition>;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export const isPermissionKey = (value: string): value is PermissionKey =>
  Object.prototype.hasOwnProperty.call(PERMISSIONS, value);

/** Splits `product.update` into its resource and action halves. */
export const splitPermission = (key: PermissionKey): { resource: string; action: string } => {
  const index = key.indexOf('.');
  return { resource: key.slice(0, index), action: key.slice(index + 1) };
};

export const permissionsByGroup = (): Record<string, PermissionKey[]> => {
  const grouped: Record<string, PermissionKey[]> = {};
  for (const key of ALL_PERMISSION_KEYS) {
    (grouped[PERMISSIONS[key].group] ??= []).push(key);
  }
  return grouped;
};

// ── Role presets ─────────────────────────────────────────────────────────────

/**
 * `SUPER_ADMIN_ROLE_KEY` holders bypass permission checks at runtime as well as
 * holding every row in `role_permissions`. The bypass means shipping a new
 * permission can never lock the owner out of their own installation.
 */
export const SUPER_ADMIN_ROLE_KEY = 'super_admin';

export type RolePreset = {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  /** Lower number = more authority. Used to block privilege escalation. */
  readonly level: number;
  readonly isSystem: boolean;
  readonly permissions: readonly PermissionKey[] | 'all';
};

const MANAGER_PERMISSIONS = [
  'dashboard.view',
  'dashboard.view_financials',
  'user.read',
  'role.read',
  'product.read',
  'product.create',
  'product.update',
  'product.delete',
  'product.export',
  'category.read',
  'category.create',
  'category.update',
  'category.delete',
  'brand.read',
  'brand.create',
  'brand.update',
  'brand.delete',
  'review.read',
  'review.moderate',
  'inventory.read',
  'inventory.adjust',
  'inventory.export',
  'order.read',
  'order.create',
  'order.update',
  'order.fulfill',
  'order.cancel',
  'order.refund',
  'order.export',
  'customer.read',
  'customer.create',
  'customer.update',
  'customer.export',
  'discount.read',
  'discount.create',
  'discount.update',
  'discount.delete',
  'report.read',
  'report.export',
  'setting.read',
] as const satisfies readonly PermissionKey[];

const STAFF_PERMISSIONS = [
  'dashboard.view',
  'product.read',
  'category.read',
  'brand.read',
  'review.read',
  'inventory.read',
  'order.read',
  'order.update',
  'order.fulfill',
  'customer.read',
  'discount.read',
  'report.read',
] as const satisfies readonly PermissionKey[];

/** Everything an admin may do: all permissions except role mutation. */
const ADMIN_PERMISSIONS = ALL_PERMISSION_KEYS.filter(
  (key) => key !== 'role.create' && key !== 'role.update' && key !== 'role.delete',
);

export const ROLE_PRESETS: readonly RolePreset[] = [
  {
    key: SUPER_ADMIN_ROLE_KEY,
    name: 'Super Admin',
    description:
      'Unrestricted access, including role and permission management. Cannot be deleted.',
    level: 0,
    isSystem: true,
    permissions: 'all',
  },
  {
    key: 'admin',
    name: 'Admin',
    description:
      'Runs the store day to day: full catalog, sales, customers, settings and audit access. Cannot change role definitions.',
    level: 10,
    isSystem: true,
    permissions: ADMIN_PERMISSIONS,
  },
  {
    key: 'manager',
    name: 'Manager',
    description:
      'Owns catalog, inventory, orders, customers and promotions, plus reporting. No access control or system settings changes.',
    level: 30,
    isSystem: true,
    permissions: MANAGER_PERMISSIONS,
  },
  {
    key: 'staff',
    name: 'Staff',
    description:
      'Fulfils orders and reads the catalog and customer records. No pricing, refunds or deletions.',
    level: 50,
    isSystem: true,
    permissions: STAFF_PERMISSIONS,
  },
] as const;

export const resolvePresetPermissions = (preset: RolePreset): PermissionKey[] =>
  preset.permissions === 'all' ? [...ALL_PERMISSION_KEYS] : [...preset.permissions];
