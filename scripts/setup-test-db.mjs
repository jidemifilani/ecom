#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

import 'dotenv/config';

/**
 * Applies the schema to the integration-test database.
 *
 * Run before `npm run test:integration`:
 *   npm run test:db:setup
 *
 * The target is TEST_DATABASE_URL, falling back to the development URL with
 * `_test` appended to the database name. The name must end in `_test`, which is
 * the same guard the integration suite applies before it truncates anything --
 * checked here too, so a mistyped URL fails before migrations run rather than
 * after they have reshaped a real database.
 */

const deriveTestUrl = () => {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      'Set TEST_DATABASE_URL, or DATABASE_URL so a test URL can be derived from it.',
    );
  }

  const url = new URL(base);
  const name = url.pathname.replace(/^\//, '') || 'ecom';
  url.pathname = `/${name.endsWith('_test') ? name : `${name}_test`}`;
  return url.toString();
};

const target = deriveTestUrl();
const databaseName = new URL(target).pathname.replace(/^\//, '');

if (!databaseName.endsWith('_test')) {
  console.error(
    `Refusing to migrate "${databaseName}": the integration database name must end in "_test".`,
  );
  process.exit(1);
}

console.log(`Applying migrations to ${databaseName} ...`);

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, DATABASE_URL: target },
});

if (result.status !== 0) {
  console.error('\nMigration failed. Is the database running and does it exist?');
  console.error(`Create it with:  createdb ${databaseName}`);
  console.error(
    `Or in Docker:    docker exec ecom-db psql -U ecom -d postgres -c "CREATE DATABASE ${databaseName}"`,
  );
  process.exit(result.status ?? 1);
}

console.log(`\n${databaseName} is ready for integration tests.`);
