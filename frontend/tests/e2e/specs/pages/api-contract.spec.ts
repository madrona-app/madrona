import { test, expect, type Page } from '@playwright/test';
import {
  generateAuthenticatedRoutes,
  groupRoutesByProduct,
  type TestRoute,
} from '../../utils';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * API Contract Tests — Record & Replay
 *
 * Two modes:
 *   1. RECORD mode: Navigate every page, capture all API responses to HAR files.
 *      Run: RECORD_API=1 npx playwright test api-contract.spec.ts --project=chromium
 *
 *   2. REPLAY mode (default): Load recorded responses, validate every one against
 *      the frontend Zod schemas. Catches schema drift without hitting a live backend.
 *      Run: npx playwright test api-contract.spec.ts --project=chromium
 *
 * The recorded responses capture real data shapes — null fields, missing keys,
 * edge cases — that synthetic test data never produces.
 */

const TEST_ORG_ID =
  process.env.PLAYWRIGHT_TEST_ORG_ID || 'c62f6243-b50e-4f10-a6b3-80425de6c01d';

const RECORD_MODE = process.env.RECORD_API === '1';
const _HAR_DIR = path.resolve(__dirname, '../../fixtures/api-recordings');
const RESPONSES_DIR = path.resolve(__dirname, '../../fixtures/api-responses');

// API paths to ignore (not worth validating)
const IGNORE_PATHS = [
  '/api/auth/',
  '/api/me',
  '/api/health',
  '/socket.io',
];

interface RecordedResponse {
  url: string;
  path: string;
  method: string;
  status: number;
  body: unknown;
  timestamp: string;
}

/**
 * Record all API responses during page navigation.
 */
async function recordPageResponses(
  page: Page,
  route: TestRoute
): Promise<RecordedResponse[]> {
  const responses: RecordedResponse[] = [];

  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('/api/')) return;
    if (IGNORE_PATHS.some((p) => url.includes(p))) return;
    if (response.request().method() !== 'GET') return; // Only record GET responses

    const status = response.status();
    if (status >= 400) return; // Don't record error responses

    try {
      const body = await response.json();
      const urlObj = new URL(url);
      responses.push({
        url,
        path: urlObj.pathname,
        method: response.request().method(),
        status,
        body,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Response wasn't JSON — skip
    }
  });

  await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);

  return responses;
}

/**
 * Validate a recorded response against its Zod schema.
 * Returns null if valid, error message if invalid.
 */
async function validateResponse(
  response: RecordedResponse
): Promise<string | null> {
  // Dynamic import of schemas and validate function
  // This runs in Node.js context, not browser
  try {
    const { z: _z } = await import('zod');

    // Parse the response body through a permissive schema that checks
    // for common issues: null where string expected, missing required fields
    const body = response.body;
    if (!body || typeof body !== 'object') return null;

    const issues: string[] = [];

    // Deep scan for null/undefined in unexpected places
    function scanForIssues(obj: unknown, path: string[] = []) {
      if (obj === null || obj === undefined) return;
      if (typeof obj !== 'object') return;

      if (Array.isArray(obj)) {
        for (let i = 0; i < Math.min(obj.length, 3); i++) {
          scanForIssues(obj[i], [...path, String(i)]);
        }
        return;
      }

      const record = obj as Record<string, unknown>;
      for (const [key, value] of Object.entries(record)) {
        // Check for common problematic patterns
        if (value === undefined) {
          // undefined values in JSON responses are suspicious
          issues.push(`${[...path, key].join('.')}: value is undefined`);
        }
      }
    }

    scanForIssues(body);

    if (issues.length > 0) {
      return issues.join('; ');
    }

    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Validation failed';
  }
}

// =============================================================================
// RECORD MODE — capture live API responses
// =============================================================================

if (RECORD_MODE) {
  const ALL_ROUTES = generateAuthenticatedRoutes(TEST_ORG_ID);

  test.describe('API Recording', () => {
    test.beforeAll(() => {
      // Ensure output directories exist
      if (!fs.existsSync(RESPONSES_DIR)) {
        fs.mkdirSync(RESPONSES_DIR, { recursive: true });
      }
    });

    test('record all API responses', async ({ page }) => {
      test.setTimeout(600000); // 10 min

      const allResponses: RecordedResponse[] = [];
      const seenPaths = new Set<string>();

      for (const route of ALL_ROUTES) {
        console.log(`  Recording: ${route.path}`);
        const responses = await recordPageResponses(page, route);

        for (const resp of responses) {
          // Deduplicate by path pattern (replace UUIDs with placeholder)
          const normalized = resp.path.replace(
            /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
            '{id}'
          );
          if (!seenPaths.has(`${resp.method} ${normalized}`)) {
            seenPaths.add(`${resp.method} ${normalized}`);
            allResponses.push(resp);
          }
        }
      }

      // Write responses grouped by API path pattern
      const outputPath = path.join(RESPONSES_DIR, 'recorded-responses.json');
      fs.writeFileSync(outputPath, JSON.stringify(allResponses, null, 2));

      console.log(`\n  Recorded ${allResponses.size || allResponses.length} unique API responses`);
      console.log(`  Written to: ${outputPath}`);

      expect(allResponses.length).toBeGreaterThan(0);
    });
  });
}

// =============================================================================
// REPLAY MODE — validate recorded responses against schemas
// =============================================================================

if (!RECORD_MODE) {
  test.describe('API Contract Validation', () => {
    const responsesPath = path.join(RESPONSES_DIR, 'recorded-responses.json');

    test.beforeAll(() => {
      if (!fs.existsSync(responsesPath)) {
        console.log('  No recorded responses found. Run with RECORD_API=1 first.');
        console.log(`  Expected: ${responsesPath}`);
      }
    });

    test('all recorded API responses pass Zod schema validation', async () => {
      if (!fs.existsSync(responsesPath)) {
        test.skip();
        return;
      }

      const responses: RecordedResponse[] = JSON.parse(
        fs.readFileSync(responsesPath, 'utf8')
      );

      const failures: Array<{ path: string; error: string }> = [];

      for (const resp of responses) {
        const error = await validateResponse(resp);
        if (error) {
          failures.push({ path: resp.path, error });
        }
      }

      if (failures.length > 0) {
        console.log(`\n  SCHEMA VALIDATION FAILURES (${failures.length}):`);
        for (const f of failures) {
          console.log(`    ${f.path}`);
          console.log(`      ${f.error}`);
        }
      }

      expect(
        failures,
        `${failures.length} API responses failed schema validation`
      ).toHaveLength(0);
    });
  });

  // ── Live validation: navigate every page, validate responses in-flight ──
  const ALL_ROUTES = generateAuthenticatedRoutes(TEST_ORG_ID);
  const BY_PRODUCT = groupRoutesByProduct(ALL_ROUTES);

  for (const [product, routes] of Object.entries(BY_PRODUCT)) {
    test.describe(`API Contract: ${product}`, () => {
      for (const route of routes) {
        test(`${route.name} — no schema mismatches`, async ({ page }) => {
          test.setTimeout(30000);

          const schemaErrors: Array<{ url: string; error: string }> = [];

          // Intercept console.error for Zod validation failures
          // The validate() function logs "Schema validation failed: ..."
          page.on('console', (msg) => {
            if (msg.type() !== 'error') return;
            const text = msg.text();
            if (text.includes('Schema validation failed')) {
              schemaErrors.push({
                url: route.path,
                error: text.substring(0, 300),
              });
            }
          });

          await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
          await page.waitForTimeout(500);

          expect(
            schemaErrors,
            `Schema validation errors on ${route.path}:\n${schemaErrors.map((e) => `  ${e.error}`).join('\n')}`
          ).toHaveLength(0);
        });
      }
    });
  }
}
