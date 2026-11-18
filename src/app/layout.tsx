import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { cookies } from 'next/headers';

import { ToastProvider } from '@/components/ui/toast';
import { THEME_COOKIE, themeAttributes } from '@/lib/theme';

import './globals.css';

/**
 * Root layout.
 *
 * Inter is loaded with the latin-ext subset as well as latin: the store is
 * market-agnostic and must render currency symbols and accented names (naira,
 * Yoruba diacritics, Eastern European Latin) without falling back to a system
 * font mid-word.
 *
 * The theme is read from a cookie and applied to `<html>` during server
 * rendering, so the correct colours are in the first byte of HTML. There is no
 * inline detection script and therefore no flash of the wrong theme, no
 * dependency on the CSP nonce, and nothing for React to warn about.
 */
const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: {
    default: 'Ecom',
    template: '%s | Ecom',
  },
  description:
    'Ecom is a multipurpose commerce platform: a storefront for shoppers and an enterprise back office for the team running it.',
  applicationName: 'Ecom',
  formatDetection: { telephone: false },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Deliberately not capping maximumScale: blocking pinch-zoom fails WCAG 1.4.4.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
};

const RootLayout = async ({ children }: { children: React.ReactNode }) => {
  const stored = (await cookies()).get(THEME_COOKIE)?.value;
  const theme = themeAttributes(stored);

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={[inter.variable, theme.className].filter(Boolean).join(' ')}
      {...(theme['data-theme'] ? { 'data-theme': theme['data-theme'] } : {})}
    >
      <body>
        <a
          href="#main"
          className="skip-link bg-surface text-fg rounded-control border-line shadow-raised border px-3 py-2 text-sm font-medium"
        >
          Skip to main content
        </a>
        {children}
        <ToastProvider />
      </body>
    </html>
  );
};

export default RootLayout;
