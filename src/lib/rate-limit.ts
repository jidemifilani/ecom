import { RateLimitError } from './api/errors';
import { db } from './db';
import { logger } from './logger';

/**
 * Fixed-window rate limiting, backed by Postgres.
 *
 * The counter is incremented with a single atomic `INSERT ... ON CONFLICT`, so
 * concurrent requests cannot race past the limit the way a read-then-write
 * would allow. Using the database (rather than process memory) means the limit
 * holds across every instance behind a load balancer.
 */

export type RateLimitBucket =
  | 'login'
  | 'login-ip'
  | 'password-forgot'
  | 'password-reset'
  | 'customer-login'
  | 'customer-register'
  | 'checkout'
  | 'review-submit';

export type RateLimitRule = {
  /** Maximum number of requests allowed inside the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
};

/**
 * Defaults are deliberately strict on credential endpoints and generous
 * elsewhere, so ordinary shopping is never throttled.
 */
export const RATE_LIMITS: Record<RateLimitBucket, RateLimitRule> = {
  login: { limit: 10, windowSeconds: 300 },
  'login-ip': { limit: 30, windowSeconds: 300 },
  'password-forgot': { limit: 5, windowSeconds: 900 },
  'password-reset': { limit: 10, windowSeconds: 900 },
  'customer-login': { limit: 10, windowSeconds: 300 },
  'customer-register': { limit: 5, windowSeconds: 3600 },
  checkout: { limit: 20, windowSeconds: 600 },
  'review-submit': { limit: 5, windowSeconds: 3600 },
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  limit: number;
  /** Seconds until the window resets. */
  retryAfter: number;
};

type CounterRow = { count: number; expiresAt: Date };

/**
 * Consumes one unit from the bucket for `identifier`.
 *
 * If the datastore is unreachable the request is allowed through and the
 * failure is logged: a rate limiter that fails closed would turn a database
 * blip into a total outage of the login page.
 */
export const consumeRateLimit = async (
  bucket: RateLimitBucket,
  identifier: string,
  overrides?: Partial<RateLimitRule>,
): Promise<RateLimitResult> => {
  const rule = { ...RATE_LIMITS[bucket], ...overrides };
  const key = `${bucket}:${identifier}`.slice(0, 255);
  const expiresAt = new Date(Date.now() + rule.windowSeconds * 1000);

  try {
    const rows = await db.$queryRaw<CounterRow[]>`
      INSERT INTO rate_limit_counters ("key", "count", "windowStart", "expiresAt")
      VALUES (${key}, 1, now(), ${expiresAt})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN rate_limit_counters."expiresAt" <= now() THEN 1
          ELSE rate_limit_counters."count" + 1
        END,
        "windowStart" = CASE
          WHEN rate_limit_counters."expiresAt" <= now() THEN now()
          ELSE rate_limit_counters."windowStart"
        END,
        "expiresAt" = CASE
          WHEN rate_limit_counters."expiresAt" <= now() THEN ${expiresAt}
          ELSE rate_limit_counters."expiresAt"
        END
      RETURNING "count", "expiresAt"
    `;

    const row = rows[0];
    if (!row) {
      return { allowed: true, remaining: rule.limit - 1, limit: rule.limit, retryAfter: 0 };
    }

    const retryAfter = Math.max(1, Math.ceil((row.expiresAt.getTime() - Date.now()) / 1000));

    return {
      allowed: row.count <= rule.limit,
      remaining: Math.max(0, rule.limit - row.count),
      limit: rule.limit,
      retryAfter,
    };
  } catch (error) {
    logger.error('Rate limiter unavailable; allowing request', { bucket, error });
    return { allowed: true, remaining: rule.limit, limit: rule.limit, retryAfter: 0 };
  }
};

/** Consumes a unit and throws a 429 when the bucket is exhausted. */
export const enforceRateLimit = async (
  bucket: RateLimitBucket,
  identifier: string,
  overrides?: Partial<RateLimitRule>,
): Promise<void> => {
  const result = await consumeRateLimit(bucket, identifier, overrides);
  if (!result.allowed) {
    throw new RateLimitError(result.retryAfter);
  }
};

/** Clears a bucket, e.g. after a successful sign-in. */
export const resetRateLimit = async (
  bucket: RateLimitBucket,
  identifier: string,
): Promise<void> => {
  await db.rateLimitCounter
    .deleteMany({ where: { key: `${bucket}:${identifier}`.slice(0, 255) } })
    .catch(() => undefined);
};

/** Housekeeping: remove windows that have already elapsed. */
export const pruneRateLimits = async (): Promise<number> => {
  const result = await db.rateLimitCounter.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
};
