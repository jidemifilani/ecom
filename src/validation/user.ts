import { z } from 'zod';

import type { Optionalise } from '@/types/util';

import { UserStatus } from '@/generated/prisma/enums';

import { emailSchema, optionalText, phoneSchema, requiredText, urlSchema, uuidSchema } from './common';

/** Staff user management schemas. */

export const createUserSchema = z.object({
  email: emailSchema,
  firstName: requiredText('a first name', 100),
  lastName: requiredText('a last name', 100),
  phone: phoneSchema,
  jobTitle: optionalText(120),
  avatarUrl: urlSchema,
  /**
   * At least one role: a staff account with no roles can sign in but see
   * nothing, which reads as a broken account rather than a deliberate state.
   */
  roleIds: z.array(uuidSchema).min(1, 'Assign at least one role.').max(10),
  status: z.enum(UserStatus).default(UserStatus.INVITED),
  /**
   * When true the account is created with a generated temporary password that
   * is emailed to the user, and they must change it on first sign-in.
   */
  sendInvite: z.boolean().optional().default(true),
});

export type CreateUserInput = Optionalise<z.infer<typeof createUserSchema>>;

export const updateUserSchema = z.object({
  firstName: requiredText('a first name', 100),
  lastName: requiredText('a last name', 100),
  phone: phoneSchema,
  jobTitle: optionalText(120),
  avatarUrl: urlSchema,
  status: z.enum(UserStatus),
  timezone: z.string().trim().min(1).max(64).optional(),
  locale: z.string().trim().min(2).max(16).optional(),
});

export type UpdateUserInput = Optionalise<z.infer<typeof updateUserSchema>>;

export const assignRolesSchema = z.object({
  roleIds: z.array(uuidSchema).min(1, 'Assign at least one role.').max(10),
});

export type AssignRolesInput = Optionalise<z.infer<typeof assignRolesSchema>>;

export const userListFilterSchema = z.object({
  status: z.enum(UserStatus).optional(),
  roleId: uuidSchema.optional(),
});

export const USER_SORT_FIELDS = [
  'createdAt',
  'lastLoginAt',
  'firstName',
  'lastName',
  'email',
  'status',
] as const;

export type UserSortField = (typeof USER_SORT_FIELDS)[number];
