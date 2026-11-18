'use client';

import { Check, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { api, toErrorMessage } from '@/lib/client/api';

/**
 * Approve / reject buttons for the moderation queue.
 *
 * Both are single-click with no confirmation: moderation is high-volume and
 * reversible (a rejected review can be approved again), so a dialog on each
 * one would cost more than the mistakes it prevents.
 */
export const ReviewModerationActions = ({
  reviewId,
  status,
  authorName,
}: {
  reviewId: string;
  status: string;
  authorName: string;
}) => {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);

  const moderate = async (next: 'APPROVED' | 'REJECTED'): Promise<void> => {
    setBusy(next === 'APPROVED' ? 'approve' : 'reject');

    try {
      await api.patch(`/api/v1/reviews/${reviewId}/moderate`, { status: next });
      toast.success(next === 'APPROVED' ? 'Review published' : 'Review rejected');
      router.refresh();
    } catch (error) {
      toast.error(toErrorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <span className="flex items-center justify-end gap-1">
      {status !== 'APPROVED' ? (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => void moderate('APPROVED')}
          loading={busy === 'approve'}
          loadingLabel="Approving"
          className="text-success"
        >
          <Check aria-hidden="true" />
          Approve
          <span className="sr-only"> review by {authorName}</span>
        </Button>
      ) : null}

      {status !== 'REJECTED' ? (
        <Button
          variant="danger-ghost"
          size="xs"
          onClick={() => void moderate('REJECTED')}
          loading={busy === 'reject'}
          loadingLabel="Rejecting"
        >
          <X aria-hidden="true" />
          Reject
          <span className="sr-only"> review by {authorName}</span>
        </Button>
      ) : null}
    </span>
  );
};

/** Star rating, readable without colour or shape perception. */
export const RatingStars = ({ rating }: { rating: number }) => (
  <span className="inline-flex items-center gap-1">
    <span aria-hidden="true" className="text-warning font-medium">
      {'*'.repeat(rating)}
      <span className="text-fg-subtle">{'*'.repeat(Math.max(0, 5 - rating))}</span>
    </span>
    <span className="text-fg-muted text-xs">{rating}/5</span>
  </span>
);
