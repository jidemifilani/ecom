import { cache } from 'react';

import { ValidationError, type FieldError } from '@/lib/api/errors';
import { recordAudit } from '@/lib/audit';
import { db } from '@/lib/db';
import {
  SETTINGS,
  SETTINGS_BY_KEY,
  coerceSettingValue,
  defaultSettings,
  type SettingsMap,
} from '@/lib/settings-registry';
import { SettingType } from '@/generated/prisma/enums';

/**
 * Application settings.
 *
 * Reads are wrapped in React's `cache`, so a page that needs the currency in
 * five components still performs one query. Writes are validated against the
 * registry, which means an unknown key or an out-of-range number is rejected
 * before it reaches the database.
 */

export const getSettings = cache(async (): Promise<SettingsMap> => {
  const rows = await db.setting.findMany({ select: { key: true, value: true } });

  // Start from the declared defaults so a key added in code but not yet seeded
  // still resolves to a sensible value rather than undefined.
  const resolved: SettingsMap = defaultSettings();

  for (const row of rows) {
    const definition = SETTINGS_BY_KEY.get(row.key);
    if (!definition) continue; // Retired setting still present in the table.

    const value = row.value as unknown;
    switch (definition.type) {
      case SettingType.BOOLEAN:
        resolved[row.key] = value === true;
        break;
      case SettingType.NUMBER:
        resolved[row.key] = typeof value === 'number' ? value : Number(value);
        break;
      default:
        resolved[row.key] = typeof value === 'string' ? value : String(value ?? '');
    }
  }

  return resolved;
});

export const getSettingString = async (key: string): Promise<string> => {
  const settings = await getSettings();
  const value = settings[key];
  return typeof value === 'string' ? value : String(value ?? '');
};

export const getSettingNumber = async (key: string): Promise<number> => {
  const settings = await getSettings();
  const value = settings[key];
  return typeof value === 'number' ? value : Number(value ?? 0);
};

export const getSettingBoolean = async (key: string): Promise<boolean> => {
  const settings = await getSettings();
  return settings[key] === true;
};

/** The subset of settings the storefront and back office read constantly. */
export type StoreConfig = {
  name: string;
  tagline: string;
  currency: string;
  locale: string;
  supportEmail: string;
  supportPhone: string;
  maintenanceMode: boolean;
  allowGuestCheckout: boolean;
  taxRateBps: number;
  taxInclusivePricing: boolean;
  flatShippingMinor: number;
  freeShippingThresholdMinor: number;
  orderNumberPrefix: string;
  lowStockThreshold: number;
  allowOversell: boolean;
  reserveOnOrder: boolean;
  productsPerPage: number;
  requireReviewApproval: boolean;
  showOutOfStock: boolean;
};

export const getStoreConfig = cache(async (): Promise<StoreConfig> => {
  const settings = await getSettings();

  const text = (key: string): string => {
    const value = settings[key];
    return typeof value === 'string' ? value : String(value ?? '');
  };
  const number = (key: string): number => {
    const value = settings[key];
    return typeof value === 'number' ? value : Number(value ?? 0);
  };
  const flag = (key: string): boolean => settings[key] === true;

  return {
    name: text('store.name') || 'Ecom',
    tagline: text('store.tagline'),
    currency: text('store.currency') || 'USD',
    locale: text('store.locale') || 'en-US',
    supportEmail: text('store.supportEmail'),
    supportPhone: text('store.supportPhone'),
    maintenanceMode: flag('store.maintenanceMode'),
    allowGuestCheckout: flag('checkout.allowGuest'),
    taxRateBps: number('checkout.taxRateBps'),
    taxInclusivePricing: flag('checkout.taxInclusivePricing'),
    flatShippingMinor: number('checkout.flatShippingMinor'),
    freeShippingThresholdMinor: number('checkout.freeShippingThresholdMinor'),
    orderNumberPrefix: text('checkout.orderNumberPrefix') || 'ORD',
    lowStockThreshold: number('inventory.lowStockThreshold'),
    allowOversell: flag('inventory.allowOversell'),
    reserveOnOrder: flag('inventory.reserveOnOrder'),
    productsPerPage: number('catalog.productsPerPage') || 12,
    requireReviewApproval: flag('catalog.requireReviewApproval'),
    showOutOfStock: flag('catalog.showOutOfStock'),
  };
});

export type SettingWithMeta = {
  key: string;
  group: string;
  label: string;
  description: string;
  type: SettingType;
  value: string | number | boolean;
  options?: readonly { readonly value: string; readonly label: string }[];
  min?: number;
  max?: number;
  updatedAt: Date | null;
  updatedByName: string | null;
};

/** Everything the /settings screen needs, in registry order. */
export const listSettingsForAdmin = async (): Promise<SettingWithMeta[]> => {
  const [resolved, rows] = await Promise.all([
    getSettings(),
    db.setting.findMany({
      select: {
        key: true,
        updatedAt: true,
        updatedBy: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const metaByKey = new Map(rows.map((row) => [row.key, row]));

  return SETTINGS.map((definition) => {
    const meta = metaByKey.get(definition.key);
    return {
      key: definition.key,
      group: definition.group,
      label: definition.label,
      description: definition.description,
      type: definition.type,
      value: resolved[definition.key] ?? definition.defaultValue,
      ...(definition.options ? { options: definition.options } : {}),
      ...(definition.min !== undefined ? { min: definition.min } : {}),
      ...(definition.max !== undefined ? { max: definition.max } : {}),
      updatedAt: meta?.updatedAt ?? null,
      updatedByName: meta?.updatedBy
        ? `${meta.updatedBy.firstName} ${meta.updatedBy.lastName}`.trim()
        : null,
    };
  });
};

export type UpdateSettingsActor = {
  userId: string;
  email: string;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
};

/**
 * Applies a partial settings change. Unknown keys are rejected rather than
 * ignored, so a typo in a payload surfaces instead of silently doing nothing.
 */
export const updateSettings = async (
  input: Record<string, unknown>,
  actor: UpdateSettingsActor,
): Promise<SettingsMap> => {
  const entries = Object.entries(input);
  if (entries.length === 0) {
    throw new ValidationError([{ path: '(root)', message: 'No settings were supplied.' }]);
  }

  const fieldErrors: FieldError[] = [];
  const accepted: { key: string; value: string | number | boolean }[] = [];

  for (const [key, raw] of entries) {
    const definition = SETTINGS_BY_KEY.get(key);
    if (!definition) {
      fieldErrors.push({ path: key, message: 'That setting does not exist.' });
      continue;
    }

    const coerced = coerceSettingValue(definition, raw);
    if (!coerced.ok) {
      fieldErrors.push({ path: key, message: coerced.error });
      continue;
    }

    accepted.push({ key, value: coerced.value });
  }

  if (fieldErrors.length > 0) throw new ValidationError(fieldErrors);

  const before = await getSettings();

  await db.$transaction(async (tx) => {
    for (const entry of accepted) {
      const definition = SETTINGS_BY_KEY.get(entry.key);
      if (!definition) continue;

      await tx.setting.upsert({
        where: { key: entry.key },
        create: {
          key: entry.key,
          group: definition.group,
          label: definition.label,
          description: definition.description,
          type: definition.type,
          value: entry.value,
          isSecret: definition.isSecret ?? false,
          updatedById: actor.userId,
        },
        update: { value: entry.value, updatedById: actor.userId },
      });
    }

    const changedKeys = accepted
      .filter((entry) => before[entry.key] !== entry.value)
      .map((entry) => entry.key);

    if (changedKeys.length > 0) {
      await recordAudit(
        {
          actor: { userId: actor.userId, email: actor.email },
          action: 'SETTING_UPDATED',
          entityType: 'Setting',
          entityLabel: changedKeys.join(', '),
          before: Object.fromEntries(changedKeys.map((key) => [key, before[key] ?? null])),
          after: Object.fromEntries(
            changedKeys.map((key) => [
              key,
              accepted.find((entry) => entry.key === key)?.value ?? null,
            ]),
          ),
          ipAddress: actor.ipAddress ?? null,
          userAgent: actor.userAgent ?? null,
          requestId: actor.requestId ?? null,
        },
        tx,
      );
    }
  });

  // `getSettings` is memoised for the lifetime of this request, so re-reading
  // it here would return the pre-update values. Merge locally instead; the next
  // request reads fresh rows from the database.
  const after: SettingsMap = { ...before };
  for (const entry of accepted) after[entry.key] = entry.value;
  return after;
};
