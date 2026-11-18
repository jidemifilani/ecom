/**
 * Password policy rules, with no server-only dependencies.
 *
 * This module is imported by both the API (to enforce) and the sign-up / reset
 * forms (to show a live checklist), so the two can never disagree about what
 * makes a password acceptable. The minimum length is passed in rather than read
 * from the environment, which keeps the module safe to bundle for the browser.
 */

export const DEFAULT_PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

/**
 * Long but trivially guessable passwords. Deliberately short: a last-resort
 * guard, not a substitute for a breach-corpus check.
 */
const BANNED_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd123',
  'qwertyuiop',
  'administrator',
  'letmein1234',
  '123456789012',
  'iloveyou1234',
  'welcome12345',
  'changeme1234',
  'admin1234567',
]);

export type PasswordContext = {
  email?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
};

export type PasswordRequirement = {
  id: string;
  label: string;
  met: boolean;
};

/**
 * Evaluates every requirement, so the UI can render a checklist rather than a
 * single pass/fail message.
 */
export const evaluatePassword = (
  password: string,
  minLength = DEFAULT_PASSWORD_MIN_LENGTH,
  context?: PasswordContext,
): PasswordRequirement[] => {
  const lowered = password.toLowerCase();

  const personal = [context?.email?.split('@')[0], context?.firstName, context?.lastName]
    .filter((value): value is string => typeof value === 'string' && value.length >= 3)
    .map((value) => value.toLowerCase());

  return [
    {
      id: 'length',
      label: `At least ${minLength} characters`,
      met: password.length >= minLength && password.length <= PASSWORD_MAX_LENGTH,
    },
    { id: 'lower', label: 'A lower-case letter', met: /[a-z]/.test(password) },
    { id: 'upper', label: 'An upper-case letter', met: /[A-Z]/.test(password) },
    { id: 'digit', label: 'A number', met: /\d/.test(password) },
    { id: 'symbol', label: 'A symbol', met: /[^A-Za-z0-9]/.test(password) },
    {
      id: 'uncommon',
      label: 'Not a commonly used password',
      met: password.length > 0 && !BANNED_PASSWORDS.has(lowered) && !/^(.)\1+$/.test(password),
    },
    {
      id: 'impersonal',
      label: 'Does not contain your name or email',
      met: password.length > 0 && !personal.some((value) => lowered.includes(value)),
    },
  ];
};

/** The unmet requirements, as user-facing messages. Empty means acceptable. */
export const checkPasswordPolicy = (
  password: string,
  minLength = DEFAULT_PASSWORD_MIN_LENGTH,
  context?: PasswordContext,
): string[] =>
  evaluatePassword(password, minLength, context)
    .filter((requirement) => !requirement.met)
    .map((requirement) => requirement.label);

export const isPasswordAcceptable = (
  password: string,
  minLength = DEFAULT_PASSWORD_MIN_LENGTH,
  context?: PasswordContext,
): boolean => checkPasswordPolicy(password, minLength, context).length === 0;

/** 0-4 strength score, for the meter. Not a security control. */
export const passwordStrength = (password: string): number => {
  if (password.length === 0) return 0;
  let score = 0;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(4, score);
};
