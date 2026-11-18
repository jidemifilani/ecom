'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { Badge, type BadgeTone } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';

/**
 * One audit entry, expandable to show the field-level diff.
 *
 * Built on <details>/<summary> semantics via a button with aria-expanded, so
 * it is operable by keyboard and announced correctly, and the diff stays out
 * of the accessibility tree until it is opened.
 */

const ACTION_TONES: Record<string, BadgeTone> = {
  CREATE: 'success',
  UPDATE: 'info',
  ARCHIVE: 'warning',
  DELETE: 'danger',
  RESTORE: 'success',
  LOGIN: 'neutral',
  LOGIN_FAILED: 'danger',
  LOGOUT: 'neutral',
  PASSWORD_CHANGED: 'warning',
  PASSWORD_RESET_REQUESTED: 'warning',
  PASSWORD_RESET_COMPLETED: 'warning',
  PASSWORD_FORCE_RESET: 'danger',
  ROLES_ASSIGNED: 'danger',
  PERMISSIONS_CHANGED: 'danger',
  SESSIONS_REVOKED: 'warning',
  SETTING_UPDATED: 'warning',
  ORDER_STATUS_CHANGED: 'info',
  ORDER_FULFILLED: 'success',
  ORDER_CANCELLED: 'warning',
  ORDER_REFUNDED: 'warning',
  STOCK_ADJUSTED: 'info',
  REVIEW_MODERATED: 'info',
  EXPORTED: 'warning',
};

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const renderValue = (value: unknown): string => {
  if (value === null || value === undefined) return '(none)';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length === 0 ? '(empty)' : value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  return text === '' ? '(empty)' : text;
};

export const AuditEntryRow = ({
  action,
  actionKey,
  actor,
  actorEmail,
  entityType,
  entityLabel,
  entityId,
  timestamp,
  ipAddress,
  userAgent,
  requestId,
  before,
  after,
}: {
  action: string;
  actionKey: string;
  actor: string;
  actorEmail: string | null;
  entityType: string;
  entityLabel: string | null;
  entityId: string | null;
  timestamp: string;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  before: unknown;
  after: unknown;
}) => {
  const [open, setOpen] = useState(false);

  const beforeRecord = asRecord(before);
  const afterRecord = asRecord(after);

  const changedKeys = [
    ...new Set([...Object.keys(beforeRecord ?? {}), ...Object.keys(afterRecord ?? {})]),
  ].sort();

  const hasDetail =
    changedKeys.length > 0 || ipAddress !== null || userAgent !== null || requestId !== null;

  return (
    <div className="px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <Badge tone={ACTION_TONES[actionKey] ?? 'neutral'} className="mt-0.5 shrink-0">
          {action}
        </Badge>

        <div className="min-w-0 flex-1">
          <p className="text-fg text-sm">
            <span className="font-medium">{actor}</span>{' '}
            <span className="text-fg-muted">
              {action.toLowerCase()} {entityType.toLowerCase()}
            </span>{' '}
            {entityLabel ? <span className="font-medium">{entityLabel}</span> : null}
          </p>

          <p className="text-fg-subtle mt-0.5 text-xs">
            {timestamp}
            {actorEmail ? ` - ${actorEmail}` : ''}
            {ipAddress ? ` - ${ipAddress}` : ''}
          </p>
        </div>

        {hasDetail ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="text-fg-muted hover:bg-surface-sunken hover:text-fg rounded-control -my-1 inline-flex shrink-0 items-center gap-1 px-2 py-2 text-xs font-medium"
          >
            {open ? 'Hide' : 'Details'}
            <ChevronDown
              className={cn('size-3.5 transition-transform duration-150', open && 'rotate-180')}
              aria-hidden="true"
            />
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="bg-surface-sunken rounded-control mt-3 p-3 text-xs">
          {changedKeys.length > 0 ? (
            <>
              <h3 className="text-fg-subtle mb-2 font-semibold tracking-wide uppercase">
                Changes
              </h3>
              <div className="table-scroll">
                <table className="w-full min-w-[32rem] border-collapse text-left">
                  <thead>
                    <tr className="text-fg-subtle">
                      <th scope="col" className="pb-1.5 pr-3 font-medium">
                        Field
                      </th>
                      <th scope="col" className="pb-1.5 pr-3 font-medium">
                        Before
                      </th>
                      <th scope="col" className="pb-1.5 font-medium">
                        After
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-line divide-y">
                    {changedKeys.map((key) => (
                      <tr key={key}>
                        <td className="text-fg py-1.5 pr-3 align-top font-mono">{key}</td>
                        <td className="text-danger py-1.5 pr-3 align-top break-all">
                          {renderValue(beforeRecord?.[key])}
                        </td>
                        <td className="text-success py-1.5 align-top break-all">
                          {renderValue(afterRecord?.[key])}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-fg-muted">No field changes were recorded for this action.</p>
          )}

          <dl className="border-line mt-3 grid gap-x-4 gap-y-1 border-t pt-3 sm:grid-cols-2">
            {entityId ? (
              <div className="flex gap-2">
                <dt className="text-fg-subtle shrink-0">Record id</dt>
                <dd className="text-fg-muted font-mono break-all">{entityId}</dd>
              </div>
            ) : null}
            {requestId ? (
              <div className="flex gap-2">
                <dt className="text-fg-subtle shrink-0">Request id</dt>
                <dd className="text-fg-muted font-mono break-all">{requestId}</dd>
              </div>
            ) : null}
            {userAgent ? (
              <div className="flex gap-2 sm:col-span-2">
                <dt className="text-fg-subtle shrink-0">Device</dt>
                <dd className="text-fg-muted break-all">{userAgent}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}
    </div>
  );
};
