#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from 'playwright';

/**
 * Captures screenshots of the running application.
 *
 * Usage:
 *   node scripts/screenshots.mjs <outputDir> [baseUrl] [sessionCookieFile]
 *
 * The session cookie is injected rather than obtained by submitting the login
 * form, because the API rejects a mutating request whose Origin does not match
 * APP_URL -- and a dev server picked for screenshots may well be on another
 * port. Read-only pages have no such check, so an injected cookie is enough.
 */

const [, , outputArg, baseArg, cookieArg] = process.argv;

const outputDir = outputArg ?? 'screenshots';
const baseUrl = baseArg ?? 'http://localhost:3002';
const cookieFile = cookieArg;

const PAGES = [
  // Storefront
  { name: '01-storefront-home', url: '/', wait: 'networkidle' },
  { name: '02-storefront-listing', url: '/search', wait: 'networkidle' },
  { name: '03-storefront-product', url: null, resolve: 'product', wait: 'networkidle' },
  { name: '04-storefront-cart', url: '/cart', wait: 'networkidle' },
  { name: '05-storefront-signin', url: '/account/login', wait: 'load' },

  // Back office
  { name: '06-admin-login', url: '/login', wait: 'load', anonymous: true },
  { name: '07-admin-dashboard', url: '/dashboard', wait: 'networkidle' },
  { name: '08-admin-orders', url: '/orders', wait: 'networkidle' },
  { name: '09-admin-products', url: '/catalog/products', wait: 'networkidle' },
  { name: '10-admin-inventory', url: '/inventory', wait: 'networkidle' },
  { name: '11-admin-roles', url: '/roles', wait: 'networkidle' },
  { name: '12-admin-settings', url: '/settings', wait: 'networkidle' },
  { name: '13-admin-audit', url: '/audit-logs', wait: 'networkidle' },
  { name: '14-admin-reports', url: '/reports', wait: 'networkidle' },
];

const MOBILE_PAGES = [
  { name: '20-mobile-storefront', url: '/' },
  { name: '21-mobile-product-list', url: '/search' },
  { name: '22-mobile-cart', url: '/cart' },
  { name: '23-mobile-dashboard', url: '/dashboard' },
  { name: '24-mobile-orders', url: '/orders' },
];

const DARK_PAGES = [
  { name: '30-dark-storefront', url: '/' },
  { name: '31-dark-dashboard', url: '/dashboard' },
  { name: '32-dark-products', url: '/catalog/products' },
];

const run = async () => {
  await mkdir(outputDir, { recursive: true });

  /*
   * Prefer Playwright's own bundled Chromium, but fall back to the installed
   * Edge. On a machine where `npx playwright install` has not been run, the
   * bundled build is missing while Edge is present, and driving Edge avoids a
   * 150MB download just to take a screenshot.
   */
  const browser = await chromium.launch().catch(async (error) => {
    console.warn(`Bundled Chromium unavailable (${error.message.split('\n')[0]}); using Edge.`);
    return chromium.launch({ channel: 'msedge' });
  });

  const sessionValue = cookieFile ? readFileSync(cookieFile, 'utf8').trim() : null;
  const domain = new URL(baseUrl).hostname;

  const cookies = sessionValue
    ? [
        { name: 'ecom_session', value: sessionValue, domain, path: '/', httpOnly: true },
        { name: 'ecom_csrf', value: 'screenshot-csrf-token', domain, path: '/' },
      ]
    : [];

  const shoot = async (
    pages,
    { width, height, dark = false, prefix = '', fullPage = true, anonymous = false },
  ) => {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      colorScheme: dark ? 'dark' : 'light',
      baseURL: baseUrl,
    });

    if (!anonymous && cookies.length > 0) await context.addCookies(cookies);

    const page = await context.newPage();

    if (dark) {
      // The app stores an explicit choice, which beats the OS preference.
      await page.addInitScript(() => {
        try {
          localStorage.setItem('ecom-theme', 'dark');
        } catch {
          /* private mode */
        }
      });
    }

    for (const spec of pages) {
      let target = spec.url;

      if (spec.resolve === 'product') {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        const href = await page
          .locator('a[href^="/p/"]')
          .first()
          .getAttribute('href')
          .catch(() => null);
        target = href ?? '/search';
      }

      const perPageContext =
        spec.anonymous && cookies.length > 0
          ? await (async () => {
              const anon = await browser.newContext({
                viewport: { width, height },
                colorScheme: dark ? 'dark' : 'light',
                baseURL: baseUrl,
              });
              return anon;
            })()
          : null;

      const activePage = perPageContext ? await perPageContext.newPage() : page;

      try {
        await activePage.goto(target, {
          waitUntil: spec.wait === 'networkidle' ? 'networkidle' : 'load',
          timeout: 45_000,
        });
        // Let charts and fonts settle so the capture is not mid-animation.
        await activePage.waitForTimeout(900);

        const file = path.join(outputDir, `${prefix}${spec.name}.png`);
        await activePage.screenshot({ path: file, fullPage });
        console.log(`captured ${prefix}${spec.name} <- ${target}`);
      } catch (error) {
        console.warn(`skipped ${spec.name}: ${error.message.split('\n')[0]}`);
      } finally {
        if (perPageContext) await perPageContext.close();
      }
    }

    await context.close();
  };

  await shoot(PAGES, { width: 1440, height: 900 });
  await shoot(MOBILE_PAGES, { width: 390, height: 844 });
  await shoot(DARK_PAGES, { width: 1440, height: 900, dark: true });

  await browser.close();
  console.log(`\nScreenshots written to ${outputDir}`);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
