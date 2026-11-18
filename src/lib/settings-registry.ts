import { SettingType } from '@/generated/prisma/enums';

/**
 * Settings registry.
 *
 * Settings are declared here once and seeded into the `settings` table. The
 * registry drives three things at once: the seed, the server-side validation of
 * an incoming change, and the form rendered on /settings. Adding a setting is
 * therefore a one-line change rather than edits in four places.
 *
 * This module is pure so the settings form can import it in the browser.
 */

export type SettingGroup = 'Store' | 'Checkout' | 'Inventory' | 'Catalog' | 'Security';

export type SettingDefinition = {
  readonly key: string;
  readonly group: SettingGroup;
  readonly label: string;
  readonly description: string;
  readonly type: SettingType;
  readonly defaultValue: string | number | boolean;
  /** Rendered as a select rather than a free-text field. */
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  readonly min?: number;
  readonly max?: number;
  readonly isSecret?: boolean;
};

export const SETTINGS: readonly SettingDefinition[] = [
  // ── Store ──────────────────────────────────────────────────────────────────
  {
    key: 'store.name',
    group: 'Store',
    label: 'Store name',
    description: 'Shown in the storefront header, page titles and emails.',
    type: SettingType.STRING,
    defaultValue: 'Ecom',
  },
  {
    key: 'store.tagline',
    group: 'Store',
    label: 'Tagline',
    description: 'A short line shown under the store name on the home page.',
    type: SettingType.STRING,
    defaultValue: 'Everything you need, one storefront.',
  },
  {
    key: 'store.currency',
    group: 'Store',
    label: 'Currency',
    description: 'ISO-4217 code used for new products and all order totals.',
    type: SettingType.STRING,
    defaultValue: 'USD',
    options: [
      { value: 'USD', label: 'USD - US Dollar' },
      { value: 'EUR', label: 'EUR - Euro' },
      { value: 'GBP', label: 'GBP - Pound Sterling' },
      { value: 'NGN', label: 'NGN - Nigerian Naira' },
      { value: 'KES', label: 'KES - Kenyan Shilling' },
      { value: 'ZAR', label: 'ZAR - South African Rand' },
      { value: 'GHS', label: 'GHS - Ghanaian Cedi' },
      { value: 'CAD', label: 'CAD - Canadian Dollar' },
      { value: 'AUD', label: 'AUD - Australian Dollar' },
      { value: 'INR', label: 'INR - Indian Rupee' },
      { value: 'JPY', label: 'JPY - Japanese Yen' },
      { value: 'AED', label: 'AED - UAE Dirham' },
    ],
  },
  {
    key: 'store.locale',
    group: 'Store',
    label: 'Number and date locale',
    description: 'Controls how prices, numbers and dates are formatted.',
    type: SettingType.STRING,
    defaultValue: 'en-US',
    options: [
      { value: 'en-US', label: 'English (United States)' },
      { value: 'en-GB', label: 'English (United Kingdom)' },
      { value: 'en-NG', label: 'English (Nigeria)' },
      { value: 'en-ZA', label: 'English (South Africa)' },
      { value: 'en-IN', label: 'English (India)' },
      { value: 'fr-FR', label: 'French (France)' },
      { value: 'de-DE', label: 'German (Germany)' },
      { value: 'es-ES', label: 'Spanish (Spain)' },
    ],
  },
  {
    key: 'store.supportEmail',
    group: 'Store',
    label: 'Support email',
    description: 'Published to shoppers for order enquiries.',
    type: SettingType.STRING,
    defaultValue: 'support@example.com',
  },
  {
    key: 'store.supportPhone',
    group: 'Store',
    label: 'Support phone',
    description: 'Optional. Shown in the storefront footer when set.',
    type: SettingType.STRING,
    defaultValue: '',
  },
  {
    key: 'store.maintenanceMode',
    group: 'Store',
    label: 'Maintenance mode',
    description: 'Closes the storefront to shoppers. The back office stays available.',
    type: SettingType.BOOLEAN,
    defaultValue: false,
  },

  // ── Checkout ───────────────────────────────────────────────────────────────
  {
    key: 'checkout.allowGuest',
    group: 'Checkout',
    label: 'Allow guest checkout',
    description: 'Let shoppers order without creating an account.',
    type: SettingType.BOOLEAN,
    defaultValue: true,
  },
  {
    key: 'checkout.taxRateBps',
    group: 'Checkout',
    label: 'Default tax rate (basis points)',
    description: 'Applied when a product has no rate of its own. 2000 = 20%.',
    type: SettingType.NUMBER,
    defaultValue: 0,
    min: 0,
    max: 10_000,
  },
  {
    key: 'checkout.taxInclusivePricing',
    group: 'Checkout',
    label: 'Prices include tax',
    description: 'When on, displayed prices already contain tax and none is added at checkout.',
    type: SettingType.BOOLEAN,
    defaultValue: false,
  },
  {
    key: 'checkout.flatShippingMinor',
    group: 'Checkout',
    label: 'Flat shipping rate (minor units)',
    description: 'Charged per order. 500 means 5.00 in the store currency.',
    type: SettingType.NUMBER,
    defaultValue: 0,
    min: 0,
    max: 100_000_000,
  },
  {
    key: 'checkout.freeShippingThresholdMinor',
    group: 'Checkout',
    label: 'Free shipping over (minor units)',
    description: 'Orders at or above this subtotal ship free. 0 disables the rule.',
    type: SettingType.NUMBER,
    defaultValue: 0,
    min: 0,
    max: 100_000_000,
  },
  {
    key: 'checkout.orderNumberPrefix',
    group: 'Checkout',
    label: 'Order number prefix',
    description: 'Prepended to the sequential order number, e.g. ORD-100248.',
    type: SettingType.STRING,
    defaultValue: 'ORD',
  },

  // ── Inventory ──────────────────────────────────────────────────────────────
  {
    key: 'inventory.lowStockThreshold',
    group: 'Inventory',
    label: 'Low stock threshold',
    description: 'Variants at or below this quantity appear in the low-stock report.',
    type: SettingType.NUMBER,
    defaultValue: 5,
    min: 0,
    max: 100_000,
  },
  {
    key: 'inventory.allowOversell',
    group: 'Inventory',
    label: 'Allow overselling',
    description: 'Accept orders for items with no stock. Off by default.',
    type: SettingType.BOOLEAN,
    defaultValue: false,
  },
  {
    key: 'inventory.reserveOnOrder',
    group: 'Inventory',
    label: 'Reserve stock when an order is placed',
    description: 'Holds stock for unpaid orders so it cannot be sold twice.',
    type: SettingType.BOOLEAN,
    defaultValue: true,
  },

  // ── Catalog ────────────────────────────────────────────────────────────────
  {
    key: 'catalog.productsPerPage',
    group: 'Catalog',
    label: 'Products per page',
    description: 'Page size used on storefront category and search listings.',
    type: SettingType.NUMBER,
    defaultValue: 12,
    min: 4,
    max: 48,
  },
  {
    key: 'catalog.requireReviewApproval',
    group: 'Catalog',
    label: 'Moderate reviews before publishing',
    description: 'New reviews stay hidden until a staff member approves them.',
    type: SettingType.BOOLEAN,
    defaultValue: true,
  },
  {
    key: 'catalog.showOutOfStock',
    group: 'Catalog',
    label: 'Show out-of-stock products',
    description: 'Keep sold-out products listed, marked as unavailable.',
    type: SettingType.BOOLEAN,
    defaultValue: true,
  },

  // ── Security ───────────────────────────────────────────────────────────────
  {
    key: 'security.sessionIdleMinutes',
    group: 'Security',
    label: 'Sign out after inactivity (minutes)',
    description: 'How long a back-office session may sit idle before it expires.',
    type: SettingType.NUMBER,
    defaultValue: 43_200,
    min: 15,
    max: 129_600,
  },
  {
    key: 'security.auditRetentionDays',
    group: 'Security',
    label: 'Audit log retention (days)',
    description: 'How long audit entries are kept before archival. 0 keeps them indefinitely.',
    type: SettingType.NUMBER,
    defaultValue: 0,
    min: 0,
    max: 3650,
  },
] as const;

export const SETTINGS_BY_KEY: ReadonlyMap<string, SettingDefinition> = new Map(
  SETTINGS.map((setting) => [setting.key, setting]),
);

export const settingGroups = (): SettingGroup[] => {
  const seen: SettingGroup[] = [];
  for (const setting of SETTINGS) {
    if (!seen.includes(setting.group)) seen.push(setting.group);
  }
  return seen;
};

export type SettingsMap = Record<string, string | number | boolean>;

/** Every default, as a flat map. Used as the fallback for an unseeded key. */
export const defaultSettings = (): SettingsMap =>
  Object.fromEntries(SETTINGS.map((setting) => [setting.key, setting.defaultValue]));

/**
 * Coerces an incoming value to the declared type and range. Returns an error
 * message instead of throwing, so the caller can attach it to the right field.
 */
export const coerceSettingValue = (
  definition: SettingDefinition,
  raw: unknown,
): { ok: true; value: string | number | boolean } | { ok: false; error: string } => {
  switch (definition.type) {
    case SettingType.BOOLEAN: {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      if (raw === 'true' || raw === 'on' || raw === '1') return { ok: true, value: true };
      if (raw === 'false' || raw === '' || raw === '0' || raw === undefined || raw === null) {
        return { ok: true, value: false };
      }
      return { ok: false, error: 'Expected a yes/no value.' };
    }
    case SettingType.NUMBER: {
      const value = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''));
      if (!Number.isFinite(value)) return { ok: false, error: 'Enter a number.' };
      if (!Number.isInteger(value)) return { ok: false, error: 'Enter a whole number.' };
      if (definition.min !== undefined && value < definition.min) {
        return { ok: false, error: `Enter ${definition.min} or more.` };
      }
      if (definition.max !== undefined && value > definition.max) {
        return { ok: false, error: `Enter ${definition.max} or less.` };
      }
      return { ok: true, value };
    }
    case SettingType.STRING: {
      const value = String(raw ?? '').trim();
      if (value.length > 500) return { ok: false, error: 'Use 500 characters or fewer.' };
      if (definition.options && value !== '') {
        const allowed = definition.options.some((option) => option.value === value);
        if (!allowed) return { ok: false, error: 'Choose one of the listed options.' };
      }
      if (definition.key === 'store.supportEmail' && value !== '') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          return { ok: false, error: 'Enter a valid email address.' };
        }
      }
      if (definition.key === 'checkout.orderNumberPrefix') {
        if (!/^[A-Za-z0-9-]{1,12}$/.test(value)) {
          return { ok: false, error: 'Use 1-12 letters, numbers or dashes.' };
        }
        return { ok: true, value: value.toUpperCase() };
      }
      return { ok: true, value };
    }
    default:
      return { ok: true, value: String(raw ?? '') };
  }
};
