import { isProduction } from './env';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Keys whose values are never written to logs, at any level. */
const REDACTED_KEYS = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'passwordhash',
  'token',
  'tokenhash',
  'authorization',
  'cookie',
  'secret',
  'authsecret',
  'clientsecret',
  'smtppassword',
  'csrftoken',
]);

const REDACTION = '[redacted]';

/** Recursively replaces sensitive values. Depth-limited to avoid cycles. */
export const redact = (value: unknown, depth = 0): unknown => {
  if (depth > 6) return '[truncated]';
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = REDACTED_KEYS.has(key.toLowerCase()) ? REDACTION : redact(nested, depth + 1);
  }
  return output;
};

const write = (level: LogLevel, message: string, context?: Record<string, unknown>): void => {
  const safeContext = context ? redact(context) : undefined;

  if (isProduction) {
    const line = JSON.stringify({
      level,
      message,
      time: new Date().toISOString(),
      ...(safeContext ? { context: safeContext } : {}),
    });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else if (level !== 'debug') console.info(line);
    return;
  }

  const line = `[${level}] ${message}`;
  if (level === 'error') console.error(line, safeContext ?? '');
  else if (level === 'warn') console.warn(line, safeContext ?? '');
  else if (level === 'debug') console.debug(line, safeContext ?? '');
  else console.info(line, safeContext ?? '');
};

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => write('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => write('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => write('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => write('error', message, context),
};
