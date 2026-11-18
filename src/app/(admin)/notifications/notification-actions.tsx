'use client';

import { CheckCheck, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/feedback';
import { toast } from '@/components/ui/toast';
import { api, toErrorMessage } from '@/lib/client/api';
import { cn } from '@/lib/utils';

/** Clears the whole unread badge in one request. */
export const MarkAllReadButton = ({ count }: { count: number }) => {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const markAll = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api.post<{ markedRead: number }>(
        '/api/v1/notifications/read-all',
      );
      toast.success(`Marked ${result.markedRead} notification(s) as read`);
      router.refresh();
    } catch (error) {
      toast.error(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={() => void markAll()} loading={busy}>
      <CheckCheck aria-hidden="true" />
      Mark all {count} as read
    </Button>
  );
};

const LEVEL_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'danger',
};

const LEVEL_LABEL: Record<string, string> = {
  INFO: 'Info',
  SUCCESS: 'Success',
  WARNING: 'Warning',
  ERROR: 'Error',
};

/**
 * One notification row.
 *
 * Read state is toggled optimistically: the row updates at once and reverts if
 * the request fails, because waiting a round trip to un-bold a line is worse
 * than the rare correction.
 */
export const NotificationRow = ({
  id,
  title,
  body,
  level,
  actionUrl,
  isRead,
  timestamp,
}: {
  id: string;
  title: string;
  body: string;
  level: string;
  actionUrl: string | null;
  isRead: boolean;
  timestamp: string;
}) => {
  const router = useRouter();
  const [read, setRead] = useState(isRead);
  const [busy, setBusy] = useState(false);

  const toggleRead = async (): Promise<void> => {
    const next = !read;
    setRead(next);
    setBusy(true);

    try {
      if (next) {
        await api.post(`/api/v1/notifications/${id}/read`);
      } else {
        await api.delete(`/api/v1/notifications/${id}/read`);
      }
      router.refresh();
    } catch (error) {
      setRead(!next);
      toast.error(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
      <Badge tone={LEVEL_TONE[level] ?? 'neutral'} className="mt-0.5 shrink-0">
        {LEVEL_LABEL[level] ?? level}
      </Badge>

      <div className="min-w-0 flex-1">
        <p className={cn('text-fg text-sm', read ? 'font-normal' : 'font-semibold')}>{title}</p>
        <p className="text-fg-muted mt-0.5 text-sm leading-relaxed">{body}</p>
        <p className="text-fg-subtle mt-1 text-xs">{timestamp}</p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {actionUrl ? (
            <Button variant="outline" size="xs" asChild>
              <Link href={actionUrl}>
                <ExternalLink aria-hidden="true" />
                Open
              </Link>
            </Button>
          ) : null}

          <Button
            variant="ghost"
            size="xs"
            onClick={() => void toggleRead()}
            disabled={busy}
            className="text-fg-muted"
          >
            {read ? 'Mark unread' : 'Mark read'}
          </Button>
        </div>
      </div>
    </div>
  );
};
