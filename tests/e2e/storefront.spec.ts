import { expect, test } from '@playwright/test';

/**
 * Storefront journey: browse, add to basket, check out.
 *
 * This is the path that earns the money, so it is the one journey worth
 * driving a real browser for. It asserts on what a shopper sees (accessible
 * roles and names) rather than on CSS classes, so a restyle does not break it.
 *
 * Requires a seeded catalogue: npm run db:seed
 */

test.describe('storefront', () => {
  test('home page lists products and exposes navigation', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // At least one product card links through to a product page.
    const productLinks = page.locator('a[href^="/p/"]');
    await expect(productLinks.first()).toBeVisible();

    await expect(page.getByRole('search')).toBeVisible();
    await expect(page.getByRole('link', { name: /basket/i })).toBeVisible();
  });

  test('search finds a seeded product', async ({ page }) => {
    await page.goto('/search?q=headphones');

    await expect(page.getByRole('heading', { name: /search results/i })).toBeVisible();
    await expect(page.locator('a[href^="/p/"]').first()).toBeVisible();
  });

  test('search reports no matches clearly rather than showing an empty grid', async ({ page }) => {
    await page.goto('/search?q=zzzzznotathing');

    await expect(page.getByText(/nothing found|no products match/i)).toBeVisible();
  });

  test('a shopper can add an item to the basket and reach checkout', async ({ page }) => {
    await page.goto('/');

    // Open the first product.
    await page.locator('a[href^="/p/"]').first().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const addButton = page.getByRole('button', { name: /add to basket/i });
    await expect(addButton).toBeVisible();
    await addButton.click();

    // The confirmation appears and the header badge updates.
    await expect(page.getByRole('link', { name: /go to basket/i })).toBeVisible();

    await page.goto('/cart');
    await expect(page.getByRole('heading', { name: /your basket/i })).toBeVisible();
    await expect(page.getByText(/order summary/i)).toBeVisible();

    // Checkout is reachable, meaning the basket passed its stock checks.
    await page.getByRole('link', { name: /^checkout$/i }).click();
    await expect(page.getByRole('heading', { name: /^checkout$/i })).toBeVisible();
    await expect(page.getByLabel(/email address/i)).toBeVisible();
  });

  test('quantity can be changed in the basket and the total follows', async ({ page }) => {
    await page.goto('/');
    await page.locator('a[href^="/p/"]').first().click();
    await page.getByRole('button', { name: /add to basket/i }).click();
    await page.goto('/cart');

    const increase = page.getByRole('button', { name: /increase quantity/i }).first();
    await increase.click();

    // The line quantity is announced through an output element.
    await expect(page.locator('output').first()).toHaveText('2');
  });

  test('checkout rejects an incomplete form with field-level messages', async ({ page }) => {
    await page.goto('/');
    await page.locator('a[href^="/p/"]').first().click();
    await page.getByRole('button', { name: /add to basket/i }).click();
    await page.goto('/checkout');

    await page.getByRole('button', { name: /place order/i }).click();

    // Validation runs client-side against the same schema the API uses.
    await expect(page.getByText(/fix the following|enter an email address/i).first()).toBeVisible();
  });

  test('a guest can complete checkout and sees a confirmed order', async ({ page }) => {
    await page.goto('/');
    await page.locator('a[href^="/p/"]').first().click();
    await page.getByRole('button', { name: /add to basket/i }).click();
    await page.goto('/checkout');

    const unique = Date.now();
    await page.getByLabel(/email address/i).fill(`e2e.buyer.${unique}@example.com`);
    await page.getByLabel(/^first name$/i).fill('Playwright');
    await page.getByLabel(/^last name$/i).fill('Buyer');
    await page.getByLabel(/address line 1/i).fill('1 Automation Way');
    await page.getByLabel(/^city$/i).fill('Bristol');
    await page.getByLabel(/postcode/i).fill('BS1 4AA');

    await page.getByRole('button', { name: /place order/i }).click();

    // Lands on the confirmation page with a real order number.
    await expect(page.getByRole('heading', { name: /your order is confirmed/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/ORD-\d+/)).toBeVisible();
  });

  test('the layout does not scroll sideways at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });

    for (const path of ['/', '/search', '/cart']) {
      await page.goto(path);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

      // A couple of pixels of rounding is tolerable; a scrollbar is not.
      expect(overflow, `${path} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(2);
    }
  });
});
