import { beforeAll } from 'vitest';

import { db } from '@/lib/db';
import { serverEnv } from '@/lib/env';

/**
 * Integration test setup.
 *
 * These tests run against a real PostgreSQL database, because the rules they
 * verify live partly in transactions and constraints rather than in
 * TypeScript. That makes the choice of database a safety matter.
 *
 * The guard below is the important part: the suite refuses to run unless the
 * database name ends in `_test`. Without it, a stray DATABASE_URL would point
 * the truncation step at a development -- or worse, production -- database.
 */

const assertSafeDatabase = (): string => {
  const url = serverEnv.DATABASE_URL;

  let databaseName: string;
  try {
    databaseName = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new Error(`Integration tests: DATABASE_URL is not a valid URL: ${url}`);
  }

  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Integration tests refuse to run against "${databaseName}". ` +
        'The database name must end in "_test" so a real database cannot be truncated. ' +
        'Set TEST_DATABASE_URL to something like ' +
        'postgresql://user:pass@localhost:5435/ecom_test?schema=public',
    );
  }

  return databaseName;
};

/**
 * Empties every table. Order does not matter because CASCADE follows the
 * foreign keys, and RESTART IDENTITY resets the order-number counter so
 * generated references are predictable within a run.
 */
export const truncateAll = async (): Promise<void> => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;

  if (tables.length === 0) return;

  const list = tables.map((row) => `"public"."${row.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
};

beforeAll(async () => {
  const databaseName = assertSafeDatabase();

  // Fail loudly if migrations have not been applied, rather than reporting a
  // confusing "relation does not exist" from the first test.
  try {
    await db.$queryRaw`SELECT 1 FROM "users" LIMIT 1`;
  } catch {
    throw new Error(
      `Integration tests: the schema is missing from "${databaseName}". ` +
        'Run: npm run test:db:setup',
    );
  }
});
