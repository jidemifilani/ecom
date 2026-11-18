import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Test configuration.
 *
 * Three projects, because they need different environments and have very
 * different costs:
 *
 *  * `unit` - pure functions. No database, no DOM. Milliseconds.
 *  * `components` - React components in jsdom.
 *  * `integration` - the service layer against a real PostgreSQL database.
 *    These are the tests that actually prove the authorization and stock rules,
 *    because those rules live in SQL constraints and transactions as much as in
 *    TypeScript.
 *
 * Integration tests point at a SEPARATE database (`ecom_test`) and the global
 * setup truncates it before the run. They must never be pointed at a
 * development or production database: `tests/integration/setup.ts` refuses to
 * run unless the URL ends in `_test`.
 */

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
};

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://ecom:ecom_dev_password@localhost:5435/ecom_test?schema=public';

/** Values the app's env schema requires in order to import at all. */
const baseEnv = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  AUTH_SECRET: 'test-secret-value-that-is-long-enough-to-pass-validation',
  MAIL_TRANSPORT: 'log',
  // Keep hashing cheap so the suite is not dominated by bcrypt.
  BCRYPT_COST: '4',
  DATABASE_URL: TEST_DATABASE_URL,
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          env: baseEnv,
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['tests/components/**/*.test.tsx'],
          setupFiles: ['tests/components/setup.ts'],
          env: baseEnv,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['tests/integration/setup.ts'],
          // Services share one database, so parallel files would interfere.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          env: baseEnv,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**', 'src/server/**', 'src/validation/**'],
      exclude: ['src/generated/**', '**/*.d.ts'],
    },
  },
});
