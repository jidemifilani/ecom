import { z } from 'zod';

import type { Optionalise } from '@/types/util';

import { ALL_PERMISSION_KEYS } from '@/lib/rbac/permissions';

import { optionalText, requiredText } from './common';

/**
 * Role and permission schemas.
 *
 * `permissions` is validated against the compiled catalogue, so a client cannot
 * invent a permission key and have it written to `role_permissions`.
 */

const permissionKeySchema = z.enum(ALL_PERMISSION_KEYS as unknown as [string, ...string[]]);

export const roleKeySchema = z
  .string()
  .trim()
  .min(2, 'Enter a role key.')
  .max(64, 'That role key is too long.')
  .toLowerCase()
  .regex(
    /^[a-z][a-z0-9_]*$/,
    'Use lower-case letters, numbers and underscores, starting with a letter.',
  );

export const createRoleSchema = z.object({
  key: roleKeySchema,
  name: requiredText('a role name', 100),
  description: optionalText(500),
  /**
   * Authority level. Lower outranks higher. Level 0 is reserved for the
   * built-in Super Admin role so no custom role can match it.
   */
  level: z.coerce
    .number({ error: 'Enter an authority level.' })
    .int('Use a whole number.')
    .min(1, 'Level 0 is reserved for Super Admin.')
    .max(999, 'Use a level between 1 and 999.')
    .default(100),
  permissions: z.array(permissionKeySchema).default([]),
});

export type CreateRoleInput = Optionalise<z.infer<typeof createRoleSchema>>;

export const updateRoleSchema = z.object({
  name: requiredText('a role name', 100),
  description: optionalText(500),
  level: z.coerce
    .number({ error: 'Enter an authority level.' })
    .int('Use a whole number.')
    .min(1, 'Level 0 is reserved for Super Admin.')
    .max(999, 'Use a level between 1 and 999.'),
  permissions: z.array(permissionKeySchema).default([]),
});

export type UpdateRoleInput = Optionalise<z.infer<typeof updateRoleSchema>>;

export const ROLE_SORT_FIELDS = ['level', 'name', 'key', 'createdAt'] as const;

export type RoleSortField = (typeof ROLE_SORT_FIELDS)[number];
