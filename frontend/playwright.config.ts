import { defineConfig, devices } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Load .env file for test credentials
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=');
      if (key && value && !process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

/**
 * Playwright E2E Test Configuration
 *
 * Run all tests:
 *   PLAYWRIGHT_TEST_EMAIL=you@example.com \
 *   PLAYWRIGHT_TEST_PASSWORD=yourpass \
 *   PLAYWRIGHT_TEST_ORG_ID=your-org-id \
 *   npm run test:e2e
 *
 * Run with UI:
 *   npm run test:e2e:ui
 *
 * Run specific test file:
 *   npx playwright test tests/e2e/specs/pages/all-buttons.spec.ts
 *
 * Run visual regression tests:
 *   npx playwright test --project=visual-chromium
 *
 * Update snapshots:
 *   npx playwright test --project=visual-chromium --update-snapshots
 *
 * Debug mode:
 *   npm run test:e2e:debug
 *
 * Generate report:
 *   npm run test:e2e:report
 */
export default defineConfig({
  testDir: './tests/e2e',

  // Run tests in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // CI ran 1 worker (serial), which made the ~580-spec functional suite blow
  // the 30-min job timeout. 2 workers ~halves wall-clock and is safe now that
  // /api/me is cached per worker (the prior 429 cascade); the runner shares 4
  // cores with postgres + backend + the preview server, so keep it modest.
  // CI also shards the suite across jobs (.github/workflows/e2e-tests.yml).
  workers: process.env.CI ? 2 : undefined,

  // Increase timeout for button tests that click many buttons
  timeout: 60000,

  // CI only: end the run before the job's timeout-minutes does. A run the
  // runner kills never reaches the end-of-run summary, so the list reporter
  // prints no failure and the HTML report is never written — the job fails
  // with nothing to read. Stopping here keeps both, and marks whatever had not
  // finished as interrupted. Leaves the workflow's setup and upload steps
  // their share of the 45-minute job.
  globalTimeout: process.env.CI ? 30 * 60_000 : 0,

  // Reporter to use
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],

  // Visual regression settings
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 100,
      animations: 'disabled',
      caret: 'hide',
    },
  },

  // Shared settings for all projects
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5174',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'on-first-retry',

    // Increase action timeout
    actionTimeout: 10000,

    // Several surfaces offer "copy link" / "copy ID" actions. Chromium denies
    // navigator.clipboard.writeText by default outside a user gesture it
    // trusts, so those buttons threw NotAllowedError and the button sweep
    // reported them as page defects rather than a missing test permission.
    permissions: ['clipboard-read', 'clipboard-write'],
  },

  // Configure projects for major browsers
  projects: [
    // Setup project - runs first to authenticate
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    // Main tests - use authenticated state from setup. Exclude visual specs;
    // those run only in the `visual-chromium` project (a separate, non-gating
    // job with a pinned viewport and managed baselines) — otherwise every
    // intentional UI change would break the functional gating run.
    {
      name: 'chromium',
      // Visual baselines run in their own project. The marketing screenshot
      // spec is excluded for a different reason: it is an asset generator, not
      // a test. It overwrites 47 tracked PNGs against whatever organization
      // happens to be seeded, so a contributor who runs the suite ends up with
      // a working tree full of modified marketing images taken from their own
      // local data. Run it deliberately with --grep or --project when the
      // assets actually need regenerating.
      testIgnore: [/.*\.visual\.spec\.ts/, /marketing-screenshots\.spec\.ts/],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/.auth/user.json',
      },
      dependencies: ['setup'],
    },
    // Visual regression tests - specific viewport for consistent screenshots
    {
      name: 'visual-chromium',
      testMatch: /.*\.visual\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/.auth/user.json',
        viewport: { width: 1280, height: 720 },
      },
      dependencies: ['setup'],
    },
    // Uncomment to add more browsers:
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'], storageState: 'tests/.auth/user.json' },
    //   dependencies: ['setup'],
    // },
  ],

  // Run local dev server before starting the tests
  // Local runs spin up the Vite dev server themselves. CI does not: the
  // workflow builds the app and serves it via scripts/serve-e2e.mjs on
  // :4173 (with the backend proxied), then points PLAYWRIGHT_BASE_URL at
  // it. Leaving a webServer block active under CI made Playwright spawn a
  // second, dev-mode server and poll :5173 — which nothing serves — so
  // every CI run died on "Timed out waiting 120000ms from
  // config.webServer" before a single test executed.
  webServer: process.env.CI
    ? undefined
    : {
        command: 'pnpm run dev',
        url: 'http://localhost:5174',
        reuseExistingServer: true,
        timeout: 120000,
      },
});
