import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '@/generated/prisma/client';

import { serverEnv } from './env';

/**
 * Prisma 7 requires an explicit driver adapter. A single pooled `pg` adapter is
 * shared per process; in development the client is cached on `globalThis` so
 * Next.js hot reloads do not open a new pool on every edit.
 */
const createPrismaClient = (): PrismaClient => {
  const adapter = new PrismaPg({ connectionString: serverEnv.DATABASE_URL });

  return new PrismaClient({
    adapter,
    log:
      serverEnv.NODE_ENV === 'development'
        ? [{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }]
        : [{ emit: 'stdout', level: 'error' }],
  });
};

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (serverEnv.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}

/** Transaction client type, for services that accept either `db` or a tx. */
export type DbClient = PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
