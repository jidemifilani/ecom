/**
 * Application error taxonomy.
 *
 * Route handlers throw these; `withApi` in `handler.ts` is the single place
 * that turns them into HTTP responses. Messages on these errors are written to
 * be safe to show a user - anything sensitive goes in `logContext`, which is
 * logged server-side and never serialised to the client.
 */

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PRECONDITION_FAILED'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INTERNAL_ERROR';

export type FieldError = {
  path: string;
  message: string;
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors?: FieldError[];
  readonly logContext?: Record<string, unknown>;
  /** Seconds the client should wait before retrying (429 / 503). */
  readonly retryAfter?: number;

  constructor(
    code: ErrorCode,
    status: number,
    message: string,
    options?: {
      fieldErrors?: FieldError[];
      logContext?: Record<string, unknown>;
      retryAfter?: number;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    if (options?.fieldErrors) this.fieldErrors = options.fieldErrors;
    if (options?.logContext) this.logContext = options.logContext;
    if (options?.retryAfter !== undefined) this.retryAfter = options.retryAfter;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'The request could not be understood.', fieldErrors?: FieldError[]) {
    super('BAD_REQUEST', 400, message, fieldErrors ? { fieldErrors } : undefined);
  }
}

export class ValidationError extends AppError {
  constructor(fieldErrors: FieldError[], message = 'Some fields need your attention.') {
    super('VALIDATION_ERROR', 422, message, { fieldErrors });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'You need to sign in to continue.') {
    super('UNAUTHENTICATED', 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message = 'You do not have permission to do that.',
    logContext?: Record<string, unknown>,
  ) {
    super('FORBIDDEN', 403, message, logContext ? { logContext } : undefined);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Record') {
    super('NOT_FOUND', 404, `${resource} not found.`);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'That conflicts with an existing record.', fieldErrors?: FieldError[]) {
    super('CONFLICT', 409, message, fieldErrors ? { fieldErrors } : undefined);
  }
}

export class PreconditionFailedError extends AppError {
  constructor(message: string) {
    super('PRECONDITION_FAILED', 412, message);
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter: number, message = 'Too many attempts. Please try again shortly.') {
    super('RATE_LIMITED', 429, message, { retryAfter });
  }
}

export class InternalError extends AppError {
  constructor(cause?: unknown, logContext?: Record<string, unknown>) {
    super('INTERNAL_ERROR', 500, 'Something went wrong on our side. Please try again.', {
      cause,
      ...(logContext ? { logContext } : {}),
    });
  }
}

export const isAppError = (value: unknown): value is AppError => value instanceof AppError;

/** Prisma error codes we translate into user-facing responses. */
const PRISMA_UNIQUE_VIOLATION = 'P2002';
const PRISMA_FOREIGN_KEY_VIOLATION = 'P2003';
const PRISMA_RECORD_NOT_FOUND = 'P2025';

type PrismaLikeError = {
  code?: unknown;
  meta?: { target?: unknown; field_name?: unknown };
};

/**
 * Maps a Prisma runtime error onto the application taxonomy. Returning
 * `undefined` means "not a Prisma error we recognise" and the caller should
 * fall through to a 500.
 */
export const mapPrismaError = (error: unknown): AppError | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as PrismaLikeError;
  if (typeof candidate.code !== 'string') return undefined;

  switch (candidate.code) {
    case PRISMA_UNIQUE_VIOLATION: {
      const target = candidate.meta?.target;
      const fields = Array.isArray(target)
        ? target.filter((item): item is string => typeof item === 'string')
        : typeof target === 'string'
          ? [target]
          : [];
      const label = fields.length > 0 ? fields.join(', ') : 'value';
      return new ConflictError(
        `A record with that ${label} already exists.`,
        fields.map((path) => ({ path, message: 'Already taken.' })),
      );
    }
    case PRISMA_FOREIGN_KEY_VIOLATION:
      return new ConflictError('A related record is missing or still in use.');
    case PRISMA_RECORD_NOT_FOUND:
      return new NotFoundError();
    default:
      return undefined;
  }
};
