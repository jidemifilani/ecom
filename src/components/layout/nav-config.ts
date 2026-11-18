import {
  BarChart3,
  Boxes,
  LayoutDashboard,
  type LucideIcon,
  Package,
  Percent,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Star,
  Tags,
  Users,
  Warehouse,
} from 'lucide-react';

import type { PermissionKey } from '@/lib/rbac/permissions';

/**
 * Back-office navigation.
 *
 * Declared once and filtered by permission, so the sidebar, the mobile drawer
 * and the bottom bar can never drift apart. An item appears only if the user
 * holds one of its permissions, which means a Staff user sees a genuinely
 * smaller app rather than a set of links that 403 when clicked.
 *
 * Hiding a link is a courtesy, not a control: the route and its API are
 * independently guarded server-side.
 */

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Visible when the user holds ANY of these. Empty means always visible. */
  permissions: readonly PermissionKey[];
  /** Also treat these path prefixes as "this item is active". */
  activePrefixes?: readonly string[];
  /** Surfaced in the bottom bar on phones (max 5 across the app). */
  primary?: boolean;
};

export type NavSection = {
  label: string | null;
  items: readonly NavItem[];
};

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: null,
    items: [
      {
        label: 'Dashboard',
        href: '/dashboard',
        icon: LayoutDashboard,
        permissions: ['dashboard.view'],
        primary: true,
      },
      {
        label: 'Orders',
        href: '/orders',
        icon: ShoppingCart,
        permissions: ['order.read'],
        primary: true,
      },
    ],
  },
  {
    label: 'Catalog',
    items: [
      {
        label: 'Products',
        href: '/catalog/products',
        icon: Package,
        permissions: ['product.read'],
        primary: true,
      },
      {
        label: 'Categories',
        href: '/catalog/categories',
        icon: Tags,
        permissions: ['category.read'],
      },
      {
        label: 'Brands',
        href: '/catalog/brands',
        icon: Boxes,
        permissions: ['brand.read'],
      },
      {
        label: 'Reviews',
        href: '/catalog/reviews',
        icon: Star,
        permissions: ['review.read'],
      },
      {
        label: 'Inventory',
        href: '/inventory',
        icon: Warehouse,
        permissions: ['inventory.read'],
        primary: true,
      },
    ],
  },
  {
    label: 'Customers',
    items: [
      {
        label: 'Customers',
        href: '/customers',
        icon: Users,
        permissions: ['customer.read'],
      },
      {
        label: 'Discounts',
        href: '/discounts',
        icon: Percent,
        permissions: ['discount.read'],
      },
    ],
  },
  {
    label: 'Insights',
    items: [
      {
        label: 'Reports',
        href: '/reports',
        icon: BarChart3,
        permissions: ['report.read'],
      },
    ],
  },
  {
    label: 'Administration',
    items: [
      {
        label: 'Users',
        href: '/users',
        icon: Users,
        permissions: ['user.read'],
      },
      {
        label: 'Roles',
        href: '/roles',
        icon: ShieldCheck,
        permissions: ['role.read'],
      },
      {
        label: 'Audit log',
        href: '/audit-logs',
        icon: ScrollText,
        permissions: ['audit_log.read'],
      },
      {
        label: 'Settings',
        href: '/settings',
        icon: Settings,
        permissions: ['setting.read'],
      },
    ],
  },
] as const;

/** Flat list of every navigable item, used for breadcrumb and title lookup. */
export const ALL_NAV_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap(
  (section) => section.items,
);

export type VisibilityCheck = (permissions: readonly PermissionKey[]) => boolean;

/** Drops items the user cannot reach, then drops sections left empty. */
export const visibleSections = (canSee: VisibilityCheck): NavSection[] =>
  NAV_SECTIONS.map((section) => ({
    label: section.label,
    items: section.items.filter((item) => item.permissions.length === 0 || canSee(item.permissions)),
  })).filter((section) => section.items.length > 0);

/**
 * The bottom bar on phones. Capped at four items plus a "More" trigger, so the
 * targets stay comfortably above the 44px minimum on a 320px-wide screen.
 */
export const bottomBarItems = (canSee: VisibilityCheck): NavItem[] =>
  ALL_NAV_ITEMS.filter(
    (item) => item.primary && (item.permissions.length === 0 || canSee(item.permissions)),
  ).slice(0, 4);

/** Longest-prefix match, so /orders/abc highlights Orders, not Dashboard. */
export const isItemActive = (item: NavItem, pathname: string): boolean => {
  if (pathname === item.href) return true;
  if (pathname.startsWith(`${item.href}/`)) return true;
  return (item.activePrefixes ?? []).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
};

export const findActiveItem = (pathname: string): NavItem | undefined => {
  const matches = ALL_NAV_ITEMS.filter((item) => isItemActive(item, pathname));
  // Prefer the most specific match (/catalog/products over /catalog).
  return matches.sort((a, b) => b.href.length - a.href.length)[0];
};
