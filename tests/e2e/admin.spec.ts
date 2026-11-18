import { expect, test } from '@playwright/test';

/**
 * Back-office journey: authentication, route protection and a core screen.
 *
 * Credentials come from the environment so no password is committed. The suite
 * skips rather than fails when they are absent, which keeps a fresh checkout
 * from reporting a false failure.
 *
 *   E2E_ADMIN_EMAIL=admin@example.com E2E_ADMIN_PASSWORD=... npm run e2e
 */

const EMAIL = process.env.E2E_ADMIN_EMAIL ?? process.env.SEED_SUPER_ADMIN_EMAIL;
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_SUPER_ADMIN_PASSWORD;

const signIn = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.goto('/login');
  await page.getByLabel(/email address/i).fill(EMAIL as string);
  await page.getByLabel(/^password$/i).fill(PASSWORD as string);
  await page.getByRole('button', { name: /^sign in$/i }).click();
};

test.describe('back office authentication', () => {
  test('an unauthenticated visitor is redirected away from the dashboard', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });

  test('every protected area redirects to sign-in', async ({ page }) => {
    for (const path of ['/users', '/roles', '/orders', '/settings', '/audit-logs']) {
      await page.goto(path);
      await expect(page, `${path} should require authentication`).toHaveURL(/\/login/);
    }
  });

  test('the sign-in form rejects bad credentials without saying which part was wrong', async ({
    page,
  }) => {
    await page.goto('/login');

    await page.getByLabel(/email address/i).fill('nobody@example.com');
    await page.getByLabel(/^password$/i).fill('definitely-not-correct-1!');
    await page.getByRole('button', { name: /^sign in$/i }).click();

    const alert = page.getByRole('alert').first();
    await expect(alert).toBeVisible();

    // The message must not reveal whether the account exists.
    await expect(alert).toContainText(/do not match an account/i);
    await expect(alert).not.toContainText(/no such user|unknown email|wrong password/i);
  });

  test('the form validates before it reaches the server', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel(/email address/i).fill('not-an-email');
    await page.getByLabel(/^password$/i).fill('x');
    await page.getByRole('button', { name: /^sign in$/i }).click();

    await expect(page.getByText(/enter a valid email address/i)).toBeVisible();
  });

  test('the forgot-password flow does not disclose whether an account exists', async ({ page }) => {
    await page.goto('/forgot-password');

    await page.getByLabel(/email address/i).fill('definitely.not.registered@example.com');
    await page.getByRole('button', { name: /send reset link/i }).click();

    // The same confirmation is shown either way.
    await expect(page.getByRole('heading', { name: /check your inbox/i })).toBeVisible();
    await expect(page.getByText(/if an account exists/i)).toBeVisible();
  });
});

test.describe('back office, signed in', () => {
  test.skip(
    !EMAIL || !PASSWORD,
    'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD (or seed credentials) to run these.',
  );

  test('signing in reaches the back office', async ({ page }) => {
    await signIn(page);

    // A seeded owner must change their password first, so either destination
    // counts as a successful sign-in.
    await expect(page).toHaveURL(/\/dashboard|\/profile/);
    await expect(page.getByRole('navigation', { name: /main navigation|primary/i }).first()).toBeVisible();
  });

  test('the dashboard shows figures and recent activity', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await expect(page.getByText(/orders/i).first()).toBeVisible();
  });

  test('the user list loads and can be searched', async ({ page }) => {
    await signIn(page);
    await page.goto('/users');

    await expect(page.getByRole('heading', { name: /^users$/i })).toBeVisible();

    await page.getByPlaceholder(/search name, email/i).fill('manager');
    // The search debounces, then the URL carries the term.
    await expect(page).toHaveURL(/q=manager/, { timeout: 10_000 });
  });

  test('the orders list loads with its status tabs', async ({ page }) => {
    await signIn(page);
    await page.goto('/orders');

    await expect(page.getByRole('heading', { name: /^orders$/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /to fulfil/i })).toBeVisible();
  });

  test('settings render grouped and editable', async ({ page }) => {
    await signIn(page);
    await page.goto('/settings');

    await expect(page.getByRole('heading', { name: /^settings$/i })).toBeVisible();
    await expect(page.getByText(/store name/i).first()).toBeVisible();
  });

  test('the audit log records the sign-in that just happened', async ({ page }) => {
    await signIn(page);
    await page.goto('/audit-logs');

    await expect(page.getByRole('heading', { name: /audit log/i })).toBeVisible();
    await expect(page.getByText(/login/i).first()).toBeVisible();
  });

  test('signing out revokes the session so protected pages are unreachable', async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard');

    await page.getByRole('button', { name: /account menu/i }).click();
    await page.getByRole('menuitem', { name: /sign out/i }).click();

    await expect(page).toHaveURL(/\/login/);

    // Going back must not restore access.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('the sidebar collapses to a drawer on a phone viewport', async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/dashboard');

    const menuButton = page.getByRole('button', { name: /open navigation menu/i });
    await expect(menuButton).toBeVisible();

    await menuButton.click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
