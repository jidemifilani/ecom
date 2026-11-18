'use client';

import { Download } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';

/**
 * CSV export trigger.
 *
 * Forwards the table's current query string, so the file matches exactly what
 * the user is looking at -- filters, search and sort included -- rather than
 * silently exporting everything.
 *
 * The response is fetched rather than navigated to, so an error surfaces as a
 * toast instead of replacing the page with a JSON blob, and the blob URL is
 * revoked once the download has been handed to the browser.
 */
export const ExportButton = ({
  resource,
  label = 'Export CSV',
  size = 'sm',
}: {
  resource: 'orders' | 'products' | 'customers' | 'inventory' | 'audit-logs';
  label?: string;
  size?: 'xs' | 'sm' | 'md';
}) => {
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);

  const download = async (): Promise<void> => {
    setBusy(true);

    try {
      const query = searchParams.toString();
      const response = await fetch(
        `/api/v1/exports/${resource}${query ? `?${query}` : ''}`,
        { credentials: 'same-origin' },
      );

      if (!response.ok) {
        let message = 'The export could not be generated.';
        try {
          const payload = (await response.json()) as {
            error?: { message?: string };
          };
          if (payload.error?.message) message = payload.error.message;
        } catch {
          // Non-JSON error body; keep the generic message.
        }
        toast.error(message);
        return;
      }

      const blob = await response.blob();

      // Prefer the filename the server chose, so the date stamp is consistent.
      const disposition = response.headers.get('content-disposition') ?? '';
      const match = /filename="?([^";]+)"?/.exec(disposition);
      const filename = match?.[1] ?? `${resource}.csv`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      toast.success('Export ready', { description: filename });
    } catch {
      toast.error('Could not reach the server to build the export.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="outline"
      size={size}
      onClick={() => void download()}
      loading={busy}
      loadingLabel="Preparing export"
    >
      <Download aria-hidden="true" />
      {label}
    </Button>
  );
};
