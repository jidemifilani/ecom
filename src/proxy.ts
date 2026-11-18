import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge proxy (formerly `middleware.ts`; Next 16 renamed the convention).
 *
 * This runs before every matched request on the edge runtime, where there is
 * no database access. It therefore does two cheap things only:
 *
 *  1. Sets a per-request Content-Security-Policy with a nonce. Next.js reads
 *     the nonce from the request header and applies it to its own scripts.
 *  2. Gates routes on the *presence* of a session cookie, purely so an
 *     unauthenticated visitor gets a clean redirect instead of a flash of the
 *     app shell.
 *
 * It is NOT an authorization boundary. The cookie is not validated here, so
 * every protected layout and API route independently resolves the session from
 * the database and checks permissions. A forged cookie gets past the proxy and
 * straight into a 401 from the real check.
 */

const STAFF_SESSION_COOKIE = 'ecom_session';
const CUSTOMER_SESSION_COOKIE = 'ecom_shop_session';
const CSRF_COOKIE = 'ecom_csrf';

/** Back-office areas that require a staff session. */
const STAFF_PREFIXES = [
  '/dashboard',
  '/users',
  '/roles',
  '/profile',
  '/notifications',
  '/reports',
  '/audit-logs',
  '/settings',
  '/catalog',
  '/inventory',
  '/orders',
  '/customers',
  '/discounts',
];

/** Storefront account areas that require a shopper session. */
const CUSTOMER_PREFIXES = ['/account'];

/** Auth screens a signed-in user should not land on again. */
const STAFF_AUTH_PAGES = ['/login', '/forgot-password', '/reset-password'];

const matchesPrefix = (pathname: string, prefixes: readonly string[]): boolean =>
  prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

const buildCsp = (nonce: string, isDev: boolean): string => {
  const scriptSrc = isDev
    ? // The dev server needs eval for React Refresh. Never enabled in production.
      `'self' 'nonce-${nonce}' 'unsafe-eval' 'strict-dynamic'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Tailwind injects a stylesheet at runtime in development, and Next inlines
    // critical CSS, so style-src needs 'unsafe-inline'. Styles cannot exfiltrate
    // data the way scripts can, and script-src remains nonce-locked.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "manifest-src 'self'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
};

export const proxy = (request: NextRequest): NextResponse => {
  const { pathname, search } = request.nextUrl;
  const isDev = process.env.NODE_ENV !== 'production';

  const nonce = crypto.randomUUID().replace(/-/g, '');
  const csp = buildCsp(nonce, isDev);

  const hasStaffSession = request.cookies.has(STAFF_SESSION_COOKIE);
  const hasCustomerSession = request.cookies.has(CUSTOMER_SESSION_COOKIE);

  // ── Redirects ──
  if (!hasStaffSession && matchesPrefix(pathname, STAFF_PREFIXES)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    // Only relative paths are preserved, so this cannot be used as an open
    // redirect to another origin.
    url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (hasStaffSession && STAFF_AUTH_PAGES.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (!hasCustomerSession && matchesPrefix(pathname, CUSTOMER_PREFIXES)) {
    // The shopper sign-in page and its sub-routes stay reachable.
    const open = ['/account/login', '/account/register', '/account/forgot-password', '/account/reset-password'];
    if (!open.includes(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = '/account/login';
      url.search = '';
      url.searchParams.set('next', `${pathname}${search}`);
      return NextResponse.redirect(url);
    }
  }

  // ── Pass through, carrying the nonce ──
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);

  // Issue the double-submit CSRF token if the visitor has none. Readable by
  // client JavaScript on purpose: that is how it gets echoed into the
  // `x-csrf-token` header. It is not a credential by itself.
  if (!request.cookies.has(CSRF_COOKIE)) {
    response.cookies.set(CSRF_COOKIE, crypto.randomUUID().replace(/-/g, ''), {
      httpOnly: false,
      secure: !isDev,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 12,
    });
  }

  return response;
};

export const config = {
  matcher: [
    /*
     * Everything except Next's own assets, the favicon and files in /public.
     * Keeping static assets out means no CSP work or cookie churn on images.
     */
    '/((?!_next/static|_next/image|favicon.ico|demo/|robots.txt|sitemap.xml).*)',
  ],
};
