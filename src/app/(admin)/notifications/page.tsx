import type { Metadata } from 'next';
import Link from 'next/link';
import { Bell } from 'lucide-react';

import { FilterBar } from '@/components/data/filter-bar';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/card';
import { Breadcrumbs, Pagination } from '@/components/ui/navigation';
import { requireUser } from '@/lib/auth/current-user';
import { safeListQuery } from '@/lib/list-query';
import { hasActiveFilters, toSearchParams, urlBuilder } from '@/lib/url';
import { cn, formatDateTime } from '@/lib/utils';
import { listNotifications } from '@/server/notification-service';

import { MarkAllReadButton, NotificationRow } from './notification-actions';

export const metadata: Metadata = { title: 'Notifications' };

const FILTER_KEYS = ['unread', 'level'] as const;

/**
 * /notifications
 *
 * The signed-in user's own notifications. Scoped by session rather than by
 * permission, since there is no notion of reading someone else's.
 */
const NotificationsPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const [user, rawParams] = await Promise.all([requireUser(), searchParams]);

  const params = toSearchParams(rawParams);
  const buildHref = urlBuilder('/notifications', params);

  const query = safeListQuery(params, {
    sortable: ['createdAt'] as const,
    defaultSort: 'createdAt',
    filterKeys: FILTER_KEYS,
    defaultPageSize: 25,
  });

  const result = await listNotifications(user.id, query);

  return (
    <>
      <Breadcrumbs items={[{ label: 'Notifications' }]} />

      <PageHeader
        title="Notifications"
        description="Order, stock and moderation alerts for the areas you have access to."
        actions={
          result.unreadCount > 0 ? <MarkAllReadButton count={result.unreadCount} /> : undefined
        }
      />

      <FilterBar
        searchPlaceholder="Search notifications"
        filters={[
          {
            key: 'unread',
            label: 'Read state',
            anyLabel: 'All notifications',
            options: [{ value: 'true', label: 'Unread only' }],
          },
          {
            key: 'level',
            label: 'Severity',
            options: [
              { value: 'ERROR', label: 'Errors' },
              { value: 'WARNING', label: 'Warnings' },
              { value: 'SUCCESS', label: 'Successes' },
              { value: 'INFO', label: 'Information' },
            ],
          },
        ]}
      />

      <div className="rounded-card border-line bg-surface overflow-hidden border">
        {result.items.length === 0 ? (
          hasActiveFilters(params, FILTER_KEYS) ? (
            <EmptyState
              icon={Bell}
              title="No matches"
              description="No notifications match the current filters."
              action={
                <Link
                  href="/notifications"
                  className="text-accent rounded text-sm font-medium underline-offset-4 hover:underline"
                >
                  Clear all filters
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={Bell}
              title="Nothing here yet"
              description="When an order is placed, stock runs low or a review needs approval, it will show up here."
            />
          )
        ) : (
          <>
            <ul className="divide-line divide-y">
              {result.items.map((item) => (
                <li key={item.id} className={cn(!item.readAt && 'bg-accent-soft/30')}>
                  <NotificationRow
                    id={item.id}
                    title={item.title}
                    body={item.body}
                    level={item.level}
                    actionUrl={item.actionUrl}
                    isRead={item.readAt !== null}
                    timestamp={formatDateTime(item.createdAt)}
                  />
                </li>
              ))}
            </ul>

            <Pagination
              page={result.page}
              pageSize={result.pageSize}
              total={result.total}
              totalPages={Math.max(1, Math.ceil(result.total / result.pageSize))}
              buildHref={(page) => buildHref({ page })}
              itemLabel="notification"
            />
          </>
        )}
      </div>

      {result.unreadCount > 0 ? (
        <p className="text-fg-subtle text-xs">
          <Badge tone="accent">{result.unreadCount}</Badge> unread
        </p>
      ) : null}
    </>
  );
};

export default NotificationsPage;
