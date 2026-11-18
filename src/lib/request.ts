import { randomUUID } from 'node:crypto';

import { AppError } from './api/errors';

/**
 * Request metadata helpers.
 *
 * Client IPs are only read from forwarding headers, which a client can forge
 * unless a trusted proxy sets them. They are therefore used for audit context
 * and rate-limit bucketing - never as an authorization input.
 */

export type ClientInfo = {
  ipAddress: string | undefined;
  userAgent: string | undefined;
  requestId: string;
};

const firstForwardedFor = (value: string | null): string | undefined => {
  if (!value) return undefined;
  const first = value.split(',')[0]?.trim();
  return first && first.length > 0 ? first.slice(0, 64) : undefined;
};

export const getClientInfo = (request: Request): ClientInfo => {
  const headers = request.headers;
  const ipAddress =
    firstForwardedFor(headers.get('x-forwarded-for')) ??
    headers.get('x-real-ip')?.slice(0, 64) ??
    headers.get('cf-connecting-ip')?.slice(0, 64) ??
    undefined;

  return {
    ipAddress,
    userAgent: headers.get('user-agent')?.slice(0, 512) ?? undefined,
    requestId: headers.get('x-request-id')?.slice(0, 64) ?? randomUUID(),
  };
};

/** Reads and size-limits a JSON body, rejecting anything that is not an object. */
export const readJsonBody = async (request: Request, maxBytes = 512 * 1024): Promise<unknown> => {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null && Number.parseInt(contentLength, 10) > maxBytes) {
    throw new PayloadTooLargeError(maxBytes);
  }

  const text = await request.text();
  if (text.length === 0) return {};
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new PayloadTooLargeError(maxBytes);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new MalformedJsonError();
  }
};

// Request-layer errors, kept out of errors.ts so that module stays free of
// transport concerns. Both extend the shared AppError taxonomy.

export class PayloadTooLargeError extends AppError {
  constructor(maxBytes: number) {
    super(
      'PAYLOAD_TOO_LARGE',
      413,
      `That request is too large. The limit is ${Math.floor(maxBytes / 1024)} KB.`,
    );
  }
}

export class MalformedJsonError extends AppError {
  constructor() {
    super('BAD_REQUEST', 400, 'The request body was not valid JSON.');
  }
}
