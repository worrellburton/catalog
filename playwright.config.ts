import { defineConfig } from '@playwright/test';

/**
 * Minimal Playwright config for the production-build smoke test.
 * Spins up `vite preview` automatically on port 4173 (Vite's default
 * preview port) and points the test runner at it. Only Chromium —
 * the bug class we're catching is bundler-level, browser engine
 * doesn't matter.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { ...{ browserName: 'chromium' } } }],
});
