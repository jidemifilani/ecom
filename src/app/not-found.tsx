import Link from 'next/link';
import { FileQuestion } from 'lucide-react';

import { Button } from '@/components/ui/button';

/** 404 page, shared by the storefront and the back office. */
const NotFound = () => (
  <div className="bg-canvas grid min-h-dvh place-items-center px-4 py-10">
    <main id="main" className="w-full max-w-md text-center">
      <span className="bg-surface-sunken text-fg-subtle mx-auto mb-5 grid size-14 place-items-center rounded-full">
        <FileQuestion className="size-7" aria-hidden="true" />
      </span>

      <h1 className="text-fg text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-fg-muted mt-3 text-sm leading-relaxed">
        The page you were looking for does not exist, or it may have been moved or archived.
      </p>

      <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button asChild>
          <Link href="/">Go to the storefront</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard">Go to the dashboard</Link>
        </Button>
      </div>
    </main>
  </div>
);

export default NotFound;
