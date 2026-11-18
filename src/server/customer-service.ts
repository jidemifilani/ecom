import { ConflictError, NotFoundError } from '@/lib/api/errors';
import type { ListQuery } from '@/lib/api/query';
import type { Paginated } from '@/lib/api/responses';
import { diffSnapshots, recordAudit } from '@/lib/audit';
import { revokeAllCustomerSessions } from '@/lib/auth/session';
import { db, type DbClient } from '@/lib/db';
import { normalizeEmail } from '@/lib/utils';
import { CustomerStatus, OrderStatus, PaymentStatus } from '@/generated/prisma/enums';
import type { AddressInput } from '@/validation/customer';
import type {
  CreateCustomerInput,
  CustomerSortField,
  UpdateCustomerInput,
} from '@/validation/customer';

import { auditActorFor, type ServiceActor } from './types';

/**
 * Customers (storefront shoppers).
 *
 * Lifetime value and order counts are computed on demand rather than stored on
 * the row: a denormalised total is one refund away from being wrong, and the
 * aggregate is cheap enough behind an index on `orders.customerId`.
 */

export type CustomerListItem = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string | null;
  status: CustomerStatus;
  marketingOptIn: boolean;
  hasAccount: boolean;
  orderCount: number;
  lastLoginAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
};

export const listCustomers = async (
  query: ListQuery<CustomerSortField>,
): Promise<Paginated<CustomerListItem>> => {
  const where = {
    ...(query.includeArchived ? {} : { deletedAt: null }),
    ...(query.filters.status ? { status: query.filters.status as CustomerStatus } : {}),
    ...(query.filters.marketingOptIn
      ? { marketingOptIn: query.filters.marketingOptIn === 'true' }
      : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          createdAt: {
            ...(query.dateFrom ? { gte: query.dateFrom } : {}),
            ...(query.dateTo ? { lte: query.dateTo } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { firstName: { contains: query.search, mode: 'insensitive' as const } },
            { lastName: { contains: query.search, mode: 'insensitive' as const } },
            { email: { contains: query.search, mode: 'insensitive' as const } },
            { phone: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.customer.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        status: true,
        marketingOptIn: true,
        passwordHash: true,
        lastLoginAt: true,
        createdAt: true,
        deletedAt: true,
        _count: { select: { orders: true } },
      },
    }),
    db.customer.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      fullName: `${row.firstName} ${row.lastName}`.trim(),
      phone: row.phone,
      status: row.status,
      marketingOptIn: row.marketingOptIn,
      hasAccount: row.passwordHash !== null,
      orderCount: row._count.orders,
      lastLoginAt: row.lastLoginAt,
      createdAt: row.createdAt,
      deletedAt: row.deletedAt,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
};

export type CustomerDetail = CustomerListItem & {
  notes: string | null;
  updatedAt: Date;
  addresses: {
    id: string;
    label: string | null;
    firstName: string;
    lastName: string;
    company: string | null;
    line1: string;
    line2: string | null;
    city: string;
    state: string | null;
    postalCode: string | null;
    countryCode: string;
    phone: string | null;
    isDefaultShipping: boolean;
    isDefaultBilling: boolean;
  }[];
  stats: {
    orderCount: number;
    lifetimeValue: number;
    averageOrderValue: number;
    currency: string;
    lastOrderAt: Date | null;
  };
};

/** Revenue only counts orders that were actually paid for, net of refunds. */
export const getCustomerStats = async (
  customerId: string,
  client: DbClient = db,
): Promise<CustomerDetail['stats']> => {
  const [aggregate, lastOrder] = await Promise.all([
    client.order.aggregate({
      where: {
        customerId,
        deletedAt: null,
        status: { notIn: [OrderStatus.CANCELLED] },
        paymentStatus: {
          in: [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED],
        },
      },
      _sum: { grandTotal: true, refundedTotal: true },
      _count: { _all: true },
    }),
    client.order.findFirst({
      where: { customerId, deletedAt: null },
      orderBy: { placedAt: 'desc' },
      select: { placedAt: true, currency: true },
    }),
  ]);

  const gross = aggregate._sum.grandTotal ?? 0;
  const refunded = aggregate._sum.refundedTotal ?? 0;
  const net = Math.max(0, gross - refunded);
  const count = aggregate._count._all;

  return {
    orderCount: count,
    lifetimeValue: net,
    averageOrderValue: count > 0 ? Math.round(net / count) : 0,
    currency: lastOrder?.currency ?? 'USD',
    lastOrderAt: lastOrder?.placedAt ?? null,
  };
};

export const getCustomer = async (id: string): Promise<CustomerDetail> => {
  const customer = await db.customer.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      status: true,
      marketingOptIn: true,
      notes: true,
      passwordHash: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      _count: { select: { orders: true } },
      addresses: {
        orderBy: [{ isDefaultShipping: 'desc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          label: true,
          firstName: true,
          lastName: true,
          company: true,
          line1: true,
          line2: true,
          city: true,
          state: true,
          postalCode: true,
          countryCode: true,
          phone: true,
          isDefaultShipping: true,
          isDefaultBilling: true,
        },
      },
    },
  });

  if (!customer) throw new NotFoundError('Customer');

  const stats = await getCustomerStats(id);

  return {
    id: customer.id,
    email: customer.email,
    firstName: customer.firstName,
    lastName: customer.lastName,
    fullName: `${customer.firstName} ${customer.lastName}`.trim(),
    phone: customer.phone,
    status: customer.status,
    marketingOptIn: customer.marketingOptIn,
    hasAccount: customer.passwordHash !== null,
    orderCount: customer._count.orders,
    lastLoginAt: customer.lastLoginAt,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
    deletedAt: customer.deletedAt,
    notes: customer.notes,
    addresses: customer.addresses,
    stats,
  };
};

export const createCustomer = async (
  input: CreateCustomerInput,
  actor: ServiceActor,
): Promise<CustomerDetail> => {
  const email = normalizeEmail(input.email);

  const existing = await db.customer.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw new ConflictError('A customer with that email address already exists.', [
      { path: 'email', message: 'Already taken.' },
    ]);
  }

  const customer = await db.customer.create({
    data: {
      email,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone ?? null,
      status: input.status,
      marketingOptIn: input.marketingOptIn,
      notes: input.notes ?? null,
    },
    select: { id: true },
  });

  await recordAudit({
    actor: auditActorFor(actor),
    action: 'CREATE',
    entityType: 'Customer',
    entityId: customer.id,
    entityLabel: `${input.firstName} ${input.lastName} <${email}>`,
    after: { email, firstName: input.firstName, lastName: input.lastName, status: input.status },
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    requestId: actor.requestId ?? null,
  });

  return getCustomer(customer.id);
};

export const updateCustomer = async (
  id: string,
  input: UpdateCustomerInput,
  actor: ServiceActor,
): Promise<CustomerDetail> => {
  const existing = await db.customer.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      status: true,
      marketingOptIn: true,
      notes: true,
    },
  });
  if (!existing) throw new NotFoundError('Customer');

  const email = normalizeEmail(input.email);
  if (email !== existing.email) {
    const clash = await db.customer.findFirst({
      where: { email, id: { not: id } },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictError('Another customer already uses that email address.', [
        { path: 'email', message: 'Already taken.' },
      ]);
    }
  }

  const after = {
    email,
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone ?? null,
    status: input.status,
    marketingOptIn: input.marketingOptIn,
    notes: input.notes ?? null,
  };

  await db.customer.update({ where: { id }, data: after });

  const diff = diffSnapshots(existing, { id: existing.id, ...after });
  await recordAudit({
    actor: auditActorFor(actor),
    action: 'UPDATE',
    entityType: 'Customer',
    entityId: id,
    entityLabel: `${input.firstName} ${input.lastName} <${email}>`,
    before: diff.before,
    after: diff.after,
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    requestId: actor.requestId ?? null,
  });

  // Blocking an account must take effect immediately.
  if (input.status === CustomerStatus.BLOCKED && existing.status !== CustomerStatus.BLOCKED) {
    await revokeAllCustomerSessions(id, 'Account blocked');
  }

  return getCustomer(id);
};

export const archiveCustomer = async (id: string, actor: ServiceActor): Promise<void> => {
  const customer = await db.customer.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  if (!customer) throw new NotFoundError('Customer');

  await db.customer.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      status: CustomerStatus.BLOCKED,
      // Free the address for re-registration without breaking order history.
      email: `${customer.email}.archived.${Date.now()}`.slice(0, 255),
    },
  });

  await revokeAllCustomerSessions(id, 'Account archived');

  await recordAudit({
    actor: auditActorFor(actor),
    action: 'ARCHIVE',
    entityType: 'Customer',
    entityId: id,
    entityLabel: `${customer.firstName} ${customer.lastName} <${customer.email}>`,
    before: { email: customer.email, deletedAt: null },
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    requestId: actor.requestId ?? null,
  });
};

// ── Addresses ────────────────────────────────────────────────────────────────

/** Ensures only one address per customer carries each default flag. */
const clearOtherDefaults = async (
  customerId: string,
  addressId: string,
  input: AddressInput,
  client: DbClient,
): Promise<void> => {
  if (input.isDefaultShipping) {
    await client.address.updateMany({
      where: { customerId, id: { not: addressId } },
      data: { isDefaultShipping: false },
    });
  }
  if (input.isDefaultBilling) {
    await client.address.updateMany({
      where: { customerId, id: { not: addressId } },
      data: { isDefaultBilling: false },
    });
  }
};

export const addAddress = async (
  customerId: string,
  input: AddressInput,
  actor: ServiceActor,
) => {
  const customer = await db.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true, _count: { select: { addresses: true } } },
  });
  if (!customer) throw new NotFoundError('Customer');

  const isFirst = customer._count.addresses === 0;

  const address = await db.$transaction(async (tx) => {
    const created = await tx.address.create({
      data: {
        customerId,
        label: input.label ?? null,
        firstName: input.firstName,
        lastName: input.lastName,
        company: input.company ?? null,
        line1: input.line1,
        line2: input.line2 ?? null,
        city: input.city,
        state: input.state ?? null,
        postalCode: input.postalCode ?? null,
        countryCode: input.countryCode,
        phone: input.phone ?? null,
        // The first address a customer saves becomes their default.
        isDefaultShipping: input.isDefaultShipping || isFirst,
        isDefaultBilling: input.isDefaultBilling || isFirst,
      },
      select: { id: true },
    });

    await clearOtherDefaults(customerId, created.id, input, tx);
    return created;
  });

  await recordAudit({
    actor: auditActorFor(actor),
    action: 'CREATE',
    entityType: 'Address',
    entityId: address.id,
    entityLabel: `${input.line1}, ${input.city}`,
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    requestId: actor.requestId ?? null,
  });

  return address;
};

export const updateAddress = async (
  addressId: string,
  input: AddressInput,
  actor: ServiceActor,
) => {
  const existing = await db.address.findUnique({
    where: { id: addressId },
    select: { id: true, customerId: true },
  });
  if (!existing) throw new NotFoundError('Address');

  await db.$transaction(async (tx) => {
    await tx.address.update({
      where: { id: addressId },
      data: {
        label: input.label ?? null,
        firstName: input.firstName,
        lastName: input.lastName,
        company: input.company ?? null,
        line1: input.line1,
        line2: input.line2 ?? null,
        city: input.city,
        state: input.state ?? null,
        postalCode: input.postalCode ?? null,
        countryCode: input.countryCode,
        phone: input.phone ?? null,
        isDefaultShipping: input.isDefaultShipping,
        isDefaultBilling: input.isDefaultBilling,
      },
    });
    await clearOtherDefaults(existing.customerId, addressId, input, tx);
  });

  await recordAudit({
    actor: auditActorFor(actor),
    action: 'UPDATE',
    entityType: 'Address',
    entityId: addressId,
    entityLabel: `${input.line1}, ${input.city}`,
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    requestId: actor.requestId ?? null,
  });

  return { id: addressId };
};

export const deleteAddress = async (addressId: string, actor: ServiceActor): Promise<void> => {
  const address = await db.address.findUnique({
    where: { id: addressId },
    select: { id: true, line1: true, city: true },
  });
  if (!address) throw new NotFoundError('Address');

  await db.address.delete({ where: { id: addressId } });

  await recordAudit({
    actor: auditActorFor(actor),
    action: 'DELETE',
    entityType: 'Address',
    entityId: addressId,
    entityLabel: `${address.line1}, ${address.city}`,
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    requestId: actor.requestId ?? null,
  });
};

export const listCustomerOptions = async (
  search: string | undefined,
): Promise<{ id: string; label: string; email: string }[]> => {
  const customers = await db.customer.findMany({
    where: {
      deletedAt: null,
      status: CustomerStatus.ACTIVE,
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' as const } },
              { lastName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    orderBy: { firstName: 'asc' },
    take: 50,
    select: { id: true, firstName: true, lastName: true, email: true },
  });

  return customers.map((customer) => ({
    id: customer.id,
    label: `${customer.firstName} ${customer.lastName}`.trim(),
    email: customer.email,
  }));
};
