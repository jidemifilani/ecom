import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { serverEnv } from '../env';

/**
 * Opaque-token helpers.
 *
 * Session cookies and password-reset links carry high-entropy random tokens.
 * Only the SHA-256 hash is ever persisted, so a stolen database dump cannot be
 * replayed as a valid session or reset link.
 */

/** 256 bits of CSPRNG entropy, URL-safe. */
export const generateToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

/** Constant-time string comparison that does not leak length through timing. */
export const safeEqual = (a: string, b: string): boolean => {
  const bufferA = createHash('sha256').update(a, 'utf8').digest();
  const bufferB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(bufferA, bufferB);
};

/** Keyed HMAC used for stateless, tamper-evident values such as CSRF tokens. */
export const sign = (value: string): string =>
  createHmac('sha256', serverEnv.AUTH_SECRET).update(value, 'utf8').digest('base64url');

export const verifySignature = (value: string, signature: string): boolean =>
  safeEqual(sign(value), signature);

/** A short, human-typable code for flows that need one (not used for auth). */
export const generateNumericCode = (digits = 6): string => {
  const max = 10 ** digits;
  // Rejection sampling keeps the distribution uniform.
  let value = max;
  while (value >= max) {
    value = Number.parseInt(randomBytes(4).toString('hex'), 16) % 10 ** digits;
  }
  return value.toString().padStart(digits, '0');
};
