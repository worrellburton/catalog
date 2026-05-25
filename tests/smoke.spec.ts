/**
 * Production-build smoke test. Loads each admin route against a
 * locally-served `vite preview` build and fails if any of them throw
 * during initial mount.
 *
 * Catches the TDZ class of bug that broke /admin/data + /admin/catalogs
 * in prod ("Cannot access 'Le'/'Fe' before initialization"). The bug
 * fires during module load, not during user interaction, so just
 * navigating to the URL and watching for uncaught errors is enough
 * to surface it.
 *
 * We deliberately don't auth or stub Supabase. The TDZ bug fires
 * before any data is needed; an unauth'd page that lands on the
 * password gate is fine, an empty admin page is fine. What's NOT
 * fine is an uncaught exception or the ErrorBoundary's 500 screen.
 */

import { test, expect } from '@playwright/test';

const ROUTES = [
  '/',
  '/admin/catalogs',
  '/admin/data',
  '/admin/users',
  '/admin/sharing',
];

for (const route of ROUTES) {
  test(`${route} loads without throwing`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      // The Remix ErrorBoundary logs "[ErrorBoundary] route error:" or
      // (now) "[error] ..." from our captureException shim. Either is
      // a smoking gun — a TDZ would have already hit pageerror, but
      // the boundary's console.error means a child render crashed too.
      if (msg.type() === 'error') {
        const txt = msg.text();
        if (/before initialization|ErrorBoundary|TypeError/i.test(txt)) {
          errors.push(`[console.error] ${txt}`);
        }
      }
    });
    await page.goto(route, { waitUntil: 'networkidle' });
    // The 500 screen the ErrorBoundary renders contains the string
    // "Something went wrong" — its presence is a hard fail.
    const errorBoundaryVisible = await page.locator('text=Something went wrong').count();
    expect(errorBoundaryVisible, `${route} rendered the 500 ErrorBoundary`).toBe(0);
    expect(errors, `${route} threw uncaught errors:\n  ${errors.join('\n  ')}`).toEqual([]);
  });
}
