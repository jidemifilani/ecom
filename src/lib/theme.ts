/**
 * Theme preference.
 *
 * Stored in a cookie rather than localStorage so the *server* can read it and
 * render the right class in the first HTML. That removes the inline
 * theme-detection script entirely, which in turn removes its dependency on the
 * CSP nonce and the "script tag while rendering" warning React 19 emits for
 * scripts inside the component tree.
 *
 * Three states:
 *   'dark'   -> <html class="dark">
 *   'light'  -> <html data-theme="light">, which opts out of the
 *               prefers-color-scheme fallback
 *   absent   -> follow the operating system
 */

export const THEME_COOKIE = 'ecom-theme';

export type ThemeChoice = 'light' | 'dark' | 'system';

export const isThemeChoice = (value: string | undefined): value is 'light' | 'dark' =>
  value === 'light' || value === 'dark';

/** Attributes for `<html>`, derived from the stored preference. */
export const themeAttributes = (
  stored: string | undefined,
): { className?: string; 'data-theme'?: string } => {
  if (stored === 'dark') return { className: 'dark' };
  if (stored === 'light') return { 'data-theme': 'light' };
  return {};
};
