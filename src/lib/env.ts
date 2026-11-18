import { z } from 'zod';

/**
 * Server-side environment contract.
 *
 * Validated once, at module load, so a misconfigured deployment fails loudly at
 * boot instead of producing confusing runtime errors later. This module must
 * never be imported from a client component — it would leak secrets into the
 * browser bundle. Import `publicConfig` instead.
 */

const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', ''])])
  .transform((value) => value === true || value === 'true' || value === '1');

const intFromString = (fallback: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return fallback;
      const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    });

const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_URL: z.url().default('http://localhost:3000'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    AUTH_SECRET: z
      .string()
      .min(32, 'AUTH_SECRET must be at least 32 characters of unguessable randomness'),

    SESSION_IDLE_TIMEOUT_SECONDS: intFromString(60 * 60 * 24 * 30),
    SESSION_ABSOLUTE_TIMEOUT_SECONDS: intFromString(60 * 60 * 24 * 90),

    PASSWORD_MIN_LENGTH: intFromString(12),
    BCRYPT_COST: intFromString(12),

    LOGIN_MAX_ATTEMPTS: intFromString(5),
    LOGIN_LOCKOUT_SECONDS: intFromString(900),

    AUTH_ENTRA_ENABLED: booleanish.default(false),
    ENTRA_TENANT_ID: z.string().optional(),
    ENTRA_CLIENT_ID: z.string().optional(),
    ENTRA_CLIENT_SECRET: z.string().optional(),
    ENTRA_REDIRECT_URI: z.string().optional(),
    ENTRA_ALLOWED_DOMAINS: z.string().optional(),

    MAIL_TRANSPORT: z.enum(['smtp', 'log']).default('log'),
    MAIL_FROM: z.string().default('Ecom <no-reply@example.com>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: intFromString(587),
    SMTP_SECURE: booleanish.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_ENTRA_ENABLED) {
      for (const key of ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when AUTH_ENTRA_ENABLED=true`,
          });
        }
      }
    }

    /*
     * Production-only rules are checked at runtime, not during `next build`.
     *
     * Next sets NODE_ENV=production while building, but a build machine has no
     * SMTP server and no public URL -- those belong to the deployment, not the
     * artefact. Enforcing them at build time would make the application
     * impossible to build in CI while doing nothing for real safety, since the
     * same checks run when the server actually starts.
     */
    const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

    if (env.NODE_ENV === 'production' && !isBuildPhase) {
      if (env.MAIL_TRANSPORT === 'log') {
        ctx.addIssue({
          code: 'custom',
          path: ['MAIL_TRANSPORT'],
          message:
            'MAIL_TRANSPORT=log discards mail. Configure SMTP before running in production.',
        });
      }
      if (env.MAIL_TRANSPORT === 'smtp' && !env.SMTP_HOST) {
        ctx.addIssue({
          code: 'custom',
          path: ['SMTP_HOST'],
          message: 'SMTP_HOST is required when MAIL_TRANSPORT=smtp',
        });
      }
      if (env.APP_URL.startsWith('http://')) {
        ctx.addIssue({
          code: 'custom',
          path: ['APP_URL'],
          message: 'APP_URL must use https in production so secure cookies are accepted',
        });
      }
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

const parseServerEnv = (): ServerEnv => {
  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return parsed.data;
};

export const serverEnv: ServerEnv = parseServerEnv();

export const isProduction = serverEnv.NODE_ENV === 'production';
export const isDevelopment = serverEnv.NODE_ENV === 'development';
export const isTest = serverEnv.NODE_ENV === 'test';

/** Values that are safe to render into the client bundle. */
export const publicConfig = {
  appUrl: serverEnv.APP_URL,
  entraEnabled: serverEnv.AUTH_ENTRA_ENABLED,
  passwordMinLength: serverEnv.PASSWORD_MIN_LENGTH,
} as const;

export const entraAllowedDomains = (): string[] =>
  (serverEnv.ENTRA_ALLOWED_DOMAINS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
