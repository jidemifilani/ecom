import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

/**
 * ESLint configuration (flat).
 *
 * eslint-config-next 16 ships native flat configs, so they are spread directly
 * rather than going through FlatCompat.
 *
 * The generated Prisma client and build output are ignored: linting
 * machine-written code produces noise nobody can act on.
 */
const config = [
  {
    ignores: [
      'src/generated/**',
      '.next/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
      'design-system/**',
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypeScript,

  {
    rules: {
      // An unused value is usually a mistake, but an underscore marks intent.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info', 'debug'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  {
    // Tests, scripts and the seed legitimately log and use loose shapes.
    files: ['tests/**/*.{ts,tsx}', 'scripts/**/*.mjs', 'prisma/seed.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];

export default config;
