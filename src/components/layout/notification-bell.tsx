'use client';

import { Bell, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/feedback';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/menu';
import { toast } from '@/components/ui/toast';
import { api, toErrorMessage } from '@/lib/client/api';
import { cn, formatDateTime } from '@/lib/utils';

/**
 * Notification bell with an unread badge and a short preview list.
 *
 * The initial items are rendered on the server, so the badge count is correct
 * on first paint rather than popping in after a fetch. Opening the menu does
 * not mark anything read: that is an explicit action, because silently
 * clearing a badge loses information the user has not seen.
 */

export type NotificationPreviewItem = {
  id: string;
  title: string;
  body: string;
  level: string;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
};

const LEVEL_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'danger',
};

export const NotificationBell = ({
  initialItems,
  initialUnreadCount,
}: {
  initialItems: NotificationPreviewItem[];
  initialUnreadCount: number;
}) => {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [unread, setUnread] = useState(initialUnreadCount);
  const [pending, startTransition] = useTransition();

  const markAllRead = async (): Promise<void> => {
    try {
      await api.post<{ markedRead: number }>('/api/v1/notifications/read-all');
      const now = new Date().toISOString();
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? now })));
      setUnread(0);
      startTransition(() => router.refresh());
    } catch (error) {
      toast.error(toErrorMessage(error));
    }
  };

  const markOneRead = async (id: string): Promise<void> => {
    try {
      await api.post(`/api/v1/notifications/${id}/read`);
      setItems((current) =>
        current.map((item) =>
          item.id === id ? { ...item, readAt: item.readAt ?? new Date().toISOString() } : item,
        ),
      );
      setUnread((count) => Math.max(0, count - 1));
    } catch {
      // A failed read-marker is not worth interrupting the user for; the badge
      // will correct itself on the next page load.
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-fg-muted relative"
          aria-label={
            unread > 0 ? `Notifications, ${unread} unread` : 'Notifications, none unread'
          }
        >
          <Bell className="size-4" aria-hidden="true" />
          {unread > 0 ? (
            <span
              aria-hidden="true"
              className="bg-danger text-on-danger absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full px-1 text-[10px] leading-4 font-semibold"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="border-line flex items-center justify-between gap-2 border-b px-3 py-2.5">
          <p className="text-fg text-sm font-semibold">Notifications</p>
          {unread > 0 ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void markAllRead()}
              disabled={pending}
              className="text-fg-muted"
            >
              <CheckCheck aria-hidden="true" />
              Mark all read
            </Button>
          ) : null}
        </div>

        {items.length === 0 ? (
          <p className="text-fg-muted px-3 py-8 text-center text-sm">
            Nothing here yet. Order and stock alerts will appear in this list.
          </p>
        ) : (
          <ul className="divide-line max-h-80 divide-y overflow-y-auto">
            {items.map((item) => {
              const content = (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className={cn(
                        'text-fg min-w-0 flex-1 text-sm',
                        item.readAt ? 'font-normal' : 'font-semibold',
                      )}
                    >
                      {item.title}
                    </p>
                    {!item.readAt ? (
                      <Badge tone={LEVEL_TONE[item.level] ?? 'neutral'} className="shrink-0">
                        New
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-fg-muted mt-0.5 line-clamp-2 text-xs leading-relaxed">
                    {item.body}
                  </p>
                  <p className="text-fg-subtle mt-1 text-[11px]">
                    {formatDateTime(item.createdAt)}
                  </p>
                </>
              );

              return (
                <li key={item.id} className={cn(!item.readAt && 'bg-accent-soft/40')}>
                  {item.actionUrl ? (
                    <Link
                      href={item.actionUrl}
                      onClick={() => void markOneRead(item.id)}
                      className="hover:bg-surface-sunken block px-3 py-2.5"
                    >
                      {content}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void markOneRead(item.id)}
                      className="hover:bg-surface-sunken block w-full px-3 py-2.5 text-left"
                    >
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <DropdownMenuSeparator className="my-0" />

        <div className="p-2">
          <Button variant="ghost" size="sm" block asChild>
            <Link href="/notifications">View all notifications</Link>
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
