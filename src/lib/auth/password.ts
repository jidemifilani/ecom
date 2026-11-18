import { createHash, randomBytes } from 'node:crypto';

import { compare, hash } from 'bcryptjs';

import { serverEnv } from '../env';

import {
  checkPasswordPolicy as checkPolicy,
  type PasswordContext,
} from './password-policy';

/**
 * Password hashing (server only).
 *
 * bcrypt silently truncates input at 72 bytes, which would make a long
 * passphrase no stronger than its first 72 bytes. We therefore pre-hash with
 * SHA-256 and feed bcrypt the base64 digest (a fixed 44 bytes). This is applied
 * uniformly, so hashing and verification always agree.
 *
 * Policy rules live in `password-policy.ts`, which the browser also imports.
 */

const prepare = (password: string): string =>
  createHash('sha256').update(password, 'utf8').digest('base64');

export const hashPassword = async (password: string): Promise<string> =>
  hash(prepare(password), serverEnv.BCRYPT_COST);

export const verifyPassword = async (password: string, passwordHash: string): Promise<boolean> => {
  try {
    return await compare(prepare(password), passwordHash);
  } catch {
    // A malformed hash in the database must read as "wrong password", never as
    // an exception that reveals which accounts have broken records.
    return false;
  }
};

/**
 * A bcrypt hash of an unguessable value. Verifying against it makes a login
 * attempt for an unknown email cost the same as one for a real account, so
 * response timing does not disclose which addresses are registered.
 */
const DECOY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.Q0bHFwSuyOcOsSXQcjYTxJ8TGqwhMkC';

export const burnPasswordComparison = async (password: string): Promise<void> => {
  await verifyPassword(password, DECOY_HASH);
};

/** Server-side policy check, using the configured minimum length. */
export const checkPasswordPolicy = (password: string, context?: PasswordContext): string[] =>
  checkPolicy(password, serverEnv.PASSWORD_MIN_LENGTH, context);

/** A policy-compliant random password, for invites and admin-forced resets. */
export const generateTemporaryPassword = (): string => {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*?-_';
  const all = upper + lower + digits + symbols;

  const pick = (alphabet: string): string => {
    const byte = randomBytes(1)[0] ?? 0;
    return alphabet.charAt(byte % alphabet.length);
  };

  const length = Math.max(serverEnv.PASSWORD_MIN_LENGTH, 16);
  const required = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  const rest = Array.from({ length: length - required.length }, () => pick(all));
  const characters = [...required, ...rest];

  // Fisher-Yates with CSPRNG indices, so the required characters are not
  // always in the first four positions.
  for (let i = characters.length - 1; i > 0; i -= 1) {
    const j = (randomBytes(1)[0] ?? 0) % (i + 1);
    const a = characters[i] as string;
    const b = characters[j] as string;
    characters[i] = b;
    characters[j] = a;
  }

  return characters.join('');
};
