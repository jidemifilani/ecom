'use client';

import { OctagonAlert, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Global error boundary.
 *
 * Shows a recovery path rather than a stack trace. In development the message
 * is printed to the console for debugging; in production the user is given the
 * `digest`, which is the handle that lets an engineer find the matching
 * server-side log entry.
 */
const GlobalError = ({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) => {
  useEffect(() => {
    // Surfaced for local debugging. Server-side logging already captured the
    // real error with full context before it reached the browser.
    console.error('Unhandled application error', error);
  }, [error]);

  return (
    <div className="bg-canvas grid min-h-dvh place-items-center px-4 py-10">
      <main id="main" className="w-full max-w-md text-center">
        <span className="bg-danger-soft text-danger mx-auto mb-5 grid size-14 place-items-center rounded-full">
          <OctagonAlert className="size-7" aria-hidden="true" />
        </span>

        <h1 className="text-fg text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-fg-muted mt-3 text-sm leading-relaxed">
          This screen could not be loaded. Trying again often resolves it; if it keeps happening,
          send the reference below to your administrator.
        </p>

        {error.digest ? (
          <p className="text-fg-subtle mt-4 font-mono text-xs">Reference: {error.digest}</p>
        ) : null}

        <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={reset}>
            <RefreshCw aria-hidden="true" />
            Try again
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard">Back to the dashboard</Link>
          </Button>
        </div>
      </main>
    </div>
  );
};

export default GlobalError;
