import { z } from 'zod';

import type { Optionalise } from '@/types/util';

import { CustomerStatus } from '@/generated/prisma/enums';

import {
  checkboxSchema,
  countryCodeSchema,
  emailSchema,
  optionalText,
  phoneSchema,
  requiredText,
} from './common';

/** Customer and address schemas, shared by the back office and the storefront. */

export const addressSchema = z.object({
  label: optionalText(60),
  firstName: requiredText('a first name', 100),
  lastName: requiredText('a last name', 100),
  company: optionalText(160),
  line1: requiredText('a street address', 240),
  line2: optionalText(240),
  city: requiredText('a city', 120),
  state: optionalText(120),
  postalCode: optionalText(32),
  countryCode: countryCodeSchema,
  phone: phoneSchema,
  isDefaultShipping: checkboxSchema,
  isDefaultBilling: checkboxSchema,
});

export type AddressInput = Optionalise<z.infer<typeof addressSchema>>;

export const createCustomerSchema = z.object({
  email: emailSchema,
  firstName: requiredText('a first name', 100),
  lastName: requiredText('a last name', 100),
  phone: phoneSchema,
  status: z.enum(CustomerStatus).default(CustomerStatus.ACTIVE),
  marketingOptIn: checkboxSchema,
  notes: optionalText(4000),
});

export type CreateCustomerInput = Optionalise<z.infer<typeof createCustomerSchema>>;

export const updateCustomerSchema = createCustomerSchema.omit({ email: true }).extend({
  email: emailSchema,
});

export type UpdateCustomerInput = Optionalise<z.infer<typeof updateCustomerSchema>>;

export const CUSTOMER_SORT_FIELDS = [
  'createdAt',
  'lastLoginAt',
  'firstName',
  'lastName',
  'email',
] as const;

export type CustomerSortField = (typeof CUSTOMER_SORT_FIELDS)[number];
