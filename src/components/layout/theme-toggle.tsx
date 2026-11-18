'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/menu';
import { THEME_COOKIE, type ThemeChoice } from '@/lib/theme';

/**
 * Light / dark / system theme switch.
 *
 * The preference lives in a cookie so the server can apply it during
 * rendering; see `src/app/layout.tsx`. This component writes the cookie and
 * updates `<html>` immediately, so the change is instant rather than waiting
 * for a round trip, then refreshes so future navigations agree with the
 * server.
 *
 * "System" clears the cookie and lets the `prefers-color-scheme` rules in
 * globals.css take over.
 */

const OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Match system', icon: Monitor },
];

/** Reads the current choice from the document, so SSR and client agree. */
const readChoice = (): ThemeChoice => {
  if (typeof document === 'undefined') return 'system';
  if (document.documentElement.classList.contains('dark')) return 'dark';
  if (document.documentElement.dataset.theme === 'light') return 'light';
  return 'system';
};

/**
 * Writes the preference and applies it to the document immediately.
 *
 * Kept at module scope, outside the component: it mutates the DOM and the
 * cookie, which are external systems rather than React state, and the React
 * compiler rightly objects to that happening inside a component body.
 *
 * The optimistic DOM write means the theme flips instantly; `router.refresh()`
 * then brings the server-rendered markup into agreement.
 */
const persistTheme = (next: ThemeChoice): void => {
  const root = document.documentElement;

  if (next === 'system') {
    document.cookie = `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax`;
    root.classList.remove('dark');
    root.removeAttribute('data-theme');
    return;
  }

  document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  root.classList.toggle('dark', next === 'dark');

  if (next === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
};

export const ThemeToggle = () => {
  const router = useRouter();
  const [choice, setChoice] = useState<ThemeChoice>(readChoice);

  const select = (next: ThemeChoice): void => {
    setChoice(next);
    persistTheme(next);
    // Keep server-rendered markup in step for subsequent navigations.
    router.refresh();
  };

  const Icon = choice === 'dark' ? Moon : choice === 'light' ? Sun : Monitor;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Theme: ${choice}. Change theme`}
          className="text-fg-muted"
        >
          <Icon className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent>
        {OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => select(option.value)}
            className={choice === option.value ? 'bg-surface-sunken' : undefined}
          >
            <option.icon aria-hidden="true" />
            {option.label}
            {choice === option.value ? <span className="sr-only"> (selected)</span> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
