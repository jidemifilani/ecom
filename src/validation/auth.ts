import { z } from 'zod';

import type { Optionalise } from '@/types/util';

import {
  DEFAULT_PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  checkPasswordPolicy,
} from '@/lib/auth/password-policy';

import { emailSchema, optionalText, phoneSchema, requiredText } from './common';

/**
 * Authentication schemas.
 *
 * `newPasswordSchema` runs the shared policy, so the API and the forms report
 * exactly the same unmet requirements. The minimum length is baked in at the
 * default here; the server re-checks with its configured value, which can only
 * be stricter.
 */

const newPasswordSchema = z
  .string()
  .min(1, 'Choose a password.')
  .max(PASSWORD_MAX_LENGTH, `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`)
  .superRefine((password, ctx) => {
    for (const issue of checkPasswordPolicy(password, DEFAULT_PASSWORD_MIN_LENGTH)) {
      ctx.addIssue({ code: 'custom', message: `Your password needs: ${issue.toLowerCase()}.` });
    }
  });

export const loginSchema = z.object({
  email: emailSchema,
  // Deliberately not policy-checked: an existing password must be accepted as
  // typed so the failure is "wrong credentials", not a validation error that
  // hints at the stored password's shape.
  password: z.string().min(1, 'Enter your password.').max(PASSWORD_MAX_LENGTH),
  rememberMe: z.boolean().optional().default(false),
});

export type LoginInput = Optionalise<z.infer<typeof loginSchema>>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export type ForgotPasswordInput = Optionalise<z.infer<typeof forgotPasswordSchema>>;

export const resetPasswordSchema = z
  .object({
    token: z.string().min(16, 'That reset link is not valid.').max(256),
    password: newPasswordSchema,
    confirmPassword: z.string().min(1, 'Confirm your new password.'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Both passwords must match.',
  });

export type ResetPasswordInput = Optionalise<z.infer<typeof resetPasswordSchema>>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.').max(PASSWORD_MAX_LENGTH),
    password: newPasswordSchema,
    confirmPassword: z.string().min(1, 'Confirm your new password.'),
    /** Sign every other device out once the password has changed. */
    revokeOtherSessions: z.boolean().optional().default(true),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Both passwords must match.',
  })
  .refine((data) => data.password !== data.currentPassword, {
    path: ['password'],
    message: 'Choose a password you have not used before.',
  });

export type ChangePasswordInput = Optionalise<z.infer<typeof changePasswordSchema>>;

export const updateProfileSchema = z.object({
  firstName: requiredText('your first name', 100),
  lastName: requiredText('your last name', 100),
  phone: phoneSchema,
  jobTitle: optionalText(120),
  timezone: z.string().trim().min(1).max(64).default('UTC'),
  locale: z.string().trim().min(2).max(16).default('en'),
});

export type UpdateProfileInput = Optionalise<z.infer<typeof updateProfileSchema>>;

// ── Storefront shopper authentication ────────────────────────────────────────

export const customerRegisterSchema = z
  .object({
    firstName: requiredText('your first name', 100),
    lastName: requiredText('your last name', 100),
    email: emailSchema,
    phone: phoneSchema,
    password: newPasswordSchema,
    confirmPassword: z.string().min(1, 'Confirm your password.'),
    marketingOptIn: z.boolean().optional().default(false),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Both passwords must match.',
  });

export type CustomerRegisterInput = Optionalise<z.infer<typeof customerRegisterSchema>>;

export const customerLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.').max(PASSWORD_MAX_LENGTH),
});

export type CustomerLoginInput = Optionalise<z.infer<typeof customerLoginSchema>>;
