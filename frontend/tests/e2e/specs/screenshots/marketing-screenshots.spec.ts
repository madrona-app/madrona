import { test, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Marketing Screenshots — 2204×1240
 *
 * Captures polished, full-page screenshots of every Madrona application
 * at marketing-ready resolution for the website and pitch deck.
 *
 * Run:
 *   npx playwright test marketing-screenshots.spec.ts --project=chromium
 *
 * Output: frontend/marketing-screenshots/
 */

const TEST_ORG_ID =
  process.env.PLAYWRIGHT_TEST_ORG_ID || 'c62f6243-b50e-4f10-a6b3-80425de6c01d';
const ORG_SLUG = 'madrona-museum';
const BASE = `/organizations/${TEST_ORG_ID}`;
const OUTPUT_DIR = path.resolve(__dirname, '../../../../marketing-screenshots');

// Viewport matches real browser usage; deviceScaleFactor produces high-res output
const WIDTH = 1920;
const HEIGHT = 1080;

interface ScreenshotConfig {
  name: string;
  path: string;
  /** Wait for this selector before capturing */
  waitFor?: string;
  /** Click these selectors before capturing (e.g., expand sections) */
  setup?: string[];
  /** Extra wait in ms after page load */
  delay?: number;
  /** Whether this is a public page (no auth) */
  public?: boolean;
  /** Description for the filename */
  filename: string;
}

// ============================================================================
// SCREENSHOT MANIFEST
// ============================================================================

const COLLECTIONS: ScreenshotConfig[] = [
  {
    name: 'Cataloging — Object Grid',
    path: `${BASE}/collections/objects`,
    filename: 'collections-objects-grid',
    delay: 1500,
  },
  {
    name: 'Object Workspace',
    path: `${BASE}/collections/objects`,
    filename: 'collections-object-workspace',
    waitFor: 'table tbody tr a',
    setup: ['table tbody tr a:first-child'],
    delay: 2000,
  },
  {
    name: 'Risk Overview Dashboard',
    path: `${BASE}/collections/risk-overview`,
    filename: 'collections-risk-overview',
    delay: 2000,
  },
  {
    name: 'Loans Out',
    path: `${BASE}/collections/loans-out`,
    filename: 'collections-loans-out',
    delay: 1500,
  },
  {
    name: 'Incoming Items',
    path: `${BASE}/collections/entries`,
    filename: 'collections-entries',
    delay: 1500,
  },
  {
    name: 'Acquisitions',
    path: `${BASE}/collections/acquisitions`,
    filename: 'collections-acquisitions',
    delay: 1500,
  },
  {
    name: 'Conservation Treatments',
    path: `${BASE}/collections/conservation`,
    filename: 'collections-conservation',
    delay: 1500,
  },
  {
    name: 'Condition Reports',
    path: `${BASE}/collections/condition-reports`,
    filename: 'collections-condition-reports',
    delay: 1500,
  },
  {
    name: 'Valuations',
    path: `${BASE}/collections/valuations`,
    filename: 'collections-valuations',
    delay: 1500,
  },
  {
    name: 'Insurance Policies',
    path: `${BASE}/collections/insurance`,
    filename: 'collections-insurance',
    delay: 1500,
  },
  {
    name: 'Constituents',
    path: `${BASE}/collections/constituents`,
    filename: 'collections-constituents',
    delay: 1500,
  },
  {
    name: 'Events',
    path: `${BASE}/collections/events`,
    filename: 'collections-events',
    delay: 1500,
  },
  {
    name: 'Exhibitions',
    path: `${BASE}/collections/exhibitions`,
    filename: 'collections-exhibitions',
    delay: 1500,
  },
  {
    name: 'Controlled Vocabularies',
    path: `${BASE}/collections/vocabularies`,
    filename: 'collections-vocabularies',
    delay: 1500,
  },
  {
    name: 'Barcode Scanner',
    path: `${BASE}/collections/barcodes/scanner`,
    filename: 'collections-barcode-scanner',
    delay: 1500,
  },
  {
    name: 'My Tasks',
    path: `${BASE}/collections/work`,
    filename: 'collections-my-tasks',
    delay: 1500,
  },
  {
    name: 'Work Sets',
    path: `${BASE}/collections/work/workspaces`,
    filename: 'collections-work-sets',
    delay: 1500,
  },
  {
    name: 'Collections Configuration',
    path: `${BASE}/collections/config`,
    filename: 'collections-config',
    delay: 1500,
  },
];

const MEDIA: ScreenshotConfig[] = [
  {
    name: 'Media Library',
    path: `${BASE}/media`,
    filename: 'media-library',
    delay: 2000,
  },
  {
    name: 'Media Analytics',
    path: `${BASE}/media/analytics`,
    filename: 'media-analytics',
    delay: 2000,
  },
  {
    name: 'Lightboxes',
    path: `${BASE}/media/collections`,
    filename: 'media-lightboxes',
    delay: 1500,
  },
  {
    name: 'Download Requests',
    path: `${BASE}/media/download-requests`,
    filename: 'media-download-requests',
    delay: 1500,
  },
  {
    name: 'Publishing',
    path: `${BASE}/media/publishing`,
    filename: 'media-publishing',
    delay: 1500,
  },
  {
    name: 'Preservation',
    path: `${BASE}/media/preservation`,
    filename: 'media-preservation',
    delay: 2000,
  },
  {
    name: 'AI Tagging',
    path: `${BASE}/media/ai-config`,
    filename: 'media-ai-tagging',
    delay: 1500,
  },
  {
    name: 'Review Queue',
    path: `${BASE}/media/review-queue`,
    filename: 'media-review-queue',
    delay: 1500,
  },
];

const BRIDGE: ScreenshotConfig[] = [
  {
    name: 'Pipeline Overview',
    path: `${BASE}/bridge`,
    filename: 'bridge-pipeline',
    delay: 2000,
  },
  {
    name: 'Run History',
    path: `${BASE}/bridge/runs`,
    filename: 'bridge-runs',
    delay: 1500,
  },
  {
    name: 'Reports',
    path: `${BASE}/bridge/reports`,
    filename: 'bridge-reports',
    delay: 1500,
  },
  {
    name: 'Datasets',
    path: `${BASE}/bridge/datasets`,
    filename: 'bridge-datasets',
    delay: 1500,
  },
  {
    name: 'Configuration',
    path: `${BASE}/bridge/setup`,
    filename: 'bridge-config',
    delay: 1500,
  },
];

const CONTENT: ScreenshotConfig[] = [
  {
    name: 'Pages',
    path: `${BASE}/content/pages`,
    filename: 'content-pages',
    delay: 1500,
  },
  {
    name: 'Blog Posts',
    path: `${BASE}/content/posts`,
    filename: 'content-blog',
    delay: 1500,
  },
  {
    name: 'Categories',
    path: `${BASE}/content/categories`,
    filename: 'content-categories',
    delay: 1500,
  },
  {
    name: 'Site Settings',
    path: `${BASE}/content/site-settings`,
    filename: 'content-site-settings',
    delay: 1500,
  },
];

const GUIDE: ScreenshotConfig[] = [
  {
    name: 'Chat Playground',
    path: `${BASE}/guide/chat`,
    filename: 'guide-chat',
    delay: 2000,
  },
  {
    name: 'Documents',
    path: `${BASE}/guide/documents`,
    filename: 'guide-documents',
    delay: 1500,
  },
];

const DISCOVER: ScreenshotConfig[] = [
  {
    name: 'Public Collection Portal',
    path: `/c/${ORG_SLUG}`,
    filename: 'discover-home',
    public: true,
    delay: 3000,
  },
  {
    name: 'Public Exhibitions',
    path: `/c/${ORG_SLUG}/exhibitions`,
    filename: 'discover-exhibitions',
    public: true,
    delay: 2000,
  },
  {
    name: 'Public Blog',
    path: `/c/${ORG_SLUG}/blog`,
    filename: 'discover-blog',
    public: true,
    delay: 2000,
  },
  {
    name: 'Public Events',
    path: `/c/${ORG_SLUG}/events`,
    filename: 'discover-events',
    public: true,
    delay: 2000,
  },
  {
    name: 'Venues',
    path: `/c/${ORG_SLUG}/visit`,
    filename: 'discover-venues',
    public: true,
    delay: 2000,
  },
];

const ADMIN: ScreenshotConfig[] = [
  {
    name: 'User Management',
    path: `${BASE}/admin/users`,
    filename: 'admin-users',
    delay: 1500,
  },
  {
    name: 'Role Management',
    path: `${BASE}/admin/roles`,
    filename: 'admin-roles',
    delay: 1500,
  },
  {
    name: 'Departments',
    path: `${BASE}/admin/departments`,
    filename: 'admin-departments',
    delay: 1500,
  },
  {
    name: 'Change History',
    path: `${BASE}/admin/entity-audit`,
    filename: 'admin-audit-log',
    delay: 1500,
  },
  {
    name: 'API Keys',
    path: `${BASE}/admin/api-keys`,
    filename: 'admin-api-keys',
    delay: 1500,
  },
];

// ============================================================================
// SCREENSHOT CAPTURE
// ============================================================================

async function captureScreenshot(
  page: Page,
  config: ScreenshotConfig
): Promise<void> {
  // Navigate
  await page.goto(config.path, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  if (!config.public) {
    // Expand all collapsed sidebar nav groups by clicking each product header
    const sidebar = page.locator('.sidebar');
    if (await sidebar.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Click each collapsed product/admin group header by name
      const groupNames = ['Work', 'Collection', 'Transactions', 'Care & Risk',
        'Rights & Reproduction', 'Programs & Research', 'Governance', 'Inventory',
        'Tools', 'Settings', 'Admin'];
      for (const name of groupNames) {
        const btn = sidebar.locator(`button[aria-expanded="false"]`).filter({ hasText: name }).first();
        if (await btn.isVisible().catch(() => false)) {
          await btn.click({ force: true }).catch(() => {});
          await page.waitForTimeout(100);
        }
      }
      // Scroll back to top
      await sidebar.evaluate((el) => el.scrollTop = 0);
      await page.waitForTimeout(200);
    }

    // Close folders panel on media library
    const hideFolders = page.locator('button[title="Hide folders"]');
    if (await hideFolders.isVisible({ timeout: 500 }).catch(() => false)) {
      await hideFolders.click();
      await page.waitForTimeout(300);
    }
  }

  // Wait for specific element if configured
  if (config.waitFor) {
    await page.locator(config.waitFor).first().waitFor({ timeout: 10000 }).catch(() => {});
  }

  // Run setup clicks (e.g., click into a record)
  if (config.setup) {
    for (const selector of config.setup) {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 5000 }).catch(() => false)) {
        await el.click({ timeout: 3000 }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      }
    }
  }

  // Wait for loading spinners to clear
  const spinner = page.locator('[data-testid="loading-spinner"], .animate-spin');
  await spinner.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});

  // Hide the "Test Role" floating button (platform admin only)
  await page.addStyleTag({ content: '.fixed.bottom-4.right-4 { display: none !important; }' });

  // Extra delay for animations and lazy content
  await page.waitForTimeout(config.delay || 1000);

  // Capture
  const filepath = path.join(OUTPUT_DIR, `${config.filename}.png`);
  await page.screenshot({
    path: filepath,
    type: 'png',
  });

  console.log(`  Captured: ${config.filename}.png`);
}

// ============================================================================
// TESTS
// ============================================================================

test.describe('Marketing Screenshots', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
  });

  // Render at real browser size, 2x scale for crisp marketing images (3840×2160 output)
  test.use({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
  });

  test.describe('Collections', () => {
    for (const config of COLLECTIONS) {
      test(config.name, async ({ page }) => {
        test.setTimeout(60000);
        await captureScreenshot(page, config);
      });
    }
  });

  test.describe('Media', () => {
    for (const config of MEDIA) {
      test(config.name, async ({ page }) => {
        test.setTimeout(60000);
        await captureScreenshot(page, config);
      });
    }
  });

  test.describe('Bridge', () => {
    for (const config of BRIDGE) {
      test(config.name, async ({ page }) => {
        test.setTimeout(60000);
        await captureScreenshot(page, config);
      });
    }
  });

  test.describe('Content', () => {
    for (const config of CONTENT) {
      test(config.name, async ({ page }) => {
        test.setTimeout(60000);
        await captureScreenshot(page, config);
      });
    }
  });

  test.describe('Guide', () => {
    for (const config of GUIDE) {
      test(config.name, async ({ page }) => {
        test.setTimeout(60000);
        await captureScreenshot(page, config);
      });
    }
  });

  test.describe('Discover (Public)', () => {
    for (const config of DISCOVER) {
      test(config.name, async ({ page }) => {
        test.setTimeout(60000);
        await captureScreenshot(page, config);
      });
    }
  });

  test.describe('Admin', () => {
    for (const config of ADMIN) {
      test(config.name, async ({ page }) => {
        test.setTimeout(60000);
        await captureScreenshot(page, config);
      });
    }
  });
});
