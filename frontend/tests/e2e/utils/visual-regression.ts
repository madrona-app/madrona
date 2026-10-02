import { Page, expect } from '@playwright/test';

/**
 * Options for taking a page screenshot.
 */
export interface ScreenshotOptions {
  /** Screenshot name (without extension) */
  name: string;
  /** Whether to capture the full scrollable page */
  fullPage?: boolean;
  /** CSS selectors to mask (e.g., timestamps, avatars, dynamic content) */
  mask?: string[];
  /** Threshold for pixel comparison (0-1) */
  threshold?: number;
  /** Maximum different pixels allowed */
  maxDiffPixels?: number;
  /** Maximum percentage of different pixels (0-100) */
  maxDiffPixelRatio?: number;
}

/**
 * Default selectors to mask in screenshots.
 * These typically contain dynamic content that would cause flaky tests.
 */
export const DEFAULT_MASK_SELECTORS = [
  // Timestamps and dates
  '[data-testid="timestamp"]',
  '[data-testid="date"]',
  'time',
  // User avatars (might load differently)
  '[data-testid="avatar"]',
  '.avatar',
  // Loading indicators
  '[data-testid="loading"]',
  '.animate-pulse',
  '.skeleton',
  // Random IDs
  '[data-testid="id"]',
];

/**
 * Take a page screenshot for visual regression testing.
 */
export async function takePageScreenshot(
  page: Page,
  options: ScreenshotOptions
): Promise<void> {
  // Wait for page to be stable
  await page.waitForLoadState('networkidle');

  // Wait for any CSS animations to settle by checking for animated elements
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      // Check if any animations are running
      const checkAnimations = () => {
        const animating = document.getAnimations().filter(a => a.playState === 'running');
        if (animating.length === 0) {
          resolve();
        } else {
          requestAnimationFrame(checkAnimations);
        }
      };
      // Initial check with a small delay
      setTimeout(checkAnimations, 100);
      // Fallback timeout
      setTimeout(resolve, 1000);
    });
  });

  // Build mask locators
  const maskSelectors = options.mask || DEFAULT_MASK_SELECTORS;
  const maskLocators = maskSelectors
    .map((selector) => page.locator(selector))
    .filter(Boolean);

  // Take screenshot with comparison
  await expect(page).toHaveScreenshot(`${options.name}.png`, {
    fullPage: options.fullPage ?? false,
    mask: maskLocators,
    threshold: options.threshold ?? 0.2,
    maxDiffPixels: options.maxDiffPixels ?? 100,
    maxDiffPixelRatio: options.maxDiffPixelRatio,
    animations: 'disabled',
    caret: 'hide',
  });
}

/**
 * Take a screenshot of a specific element.
 */
export async function takeElementScreenshot(
  page: Page,
  selector: string,
  options: Omit<ScreenshotOptions, 'fullPage'>
): Promise<void> {
  const element = page.locator(selector);

  // Wait for element to be visible
  await expect(element).toBeVisible();

  // Wait for any CSS animations to settle
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      const checkAnimations = () => {
        const animating = document.getAnimations().filter(a => a.playState === 'running');
        if (animating.length === 0) {
          resolve();
        } else {
          requestAnimationFrame(checkAnimations);
        }
      };
      // Initial check with a small delay
      setTimeout(checkAnimations, 50);
      // Fallback timeout
      setTimeout(resolve, 500);
    });
  });

  // Build mask locators within the element
  const maskSelectors = options.mask || DEFAULT_MASK_SELECTORS;
  const maskLocators = maskSelectors
    .map((s) => element.locator(s))
    .filter(Boolean);

  // Take screenshot
  await expect(element).toHaveScreenshot(`${options.name}.png`, {
    mask: maskLocators,
    threshold: options.threshold ?? 0.2,
    maxDiffPixels: options.maxDiffPixels ?? 50,
    animations: 'disabled',
    caret: 'hide',
  });
}

/**
 * Compare two screenshots and return the diff percentage.
 */
export async function compareScreenshots(
  page: Page,
  name: string,
  options?: Pick<ScreenshotOptions, 'threshold' | 'maxDiffPixels'>
): Promise<void> {
  await takePageScreenshot(page, {
    name,
    threshold: options?.threshold,
    maxDiffPixels: options?.maxDiffPixels,
  });
}

/**
 * Visual test helper that handles common setup.
 */
export class VisualTestHelper {
  constructor(
    private page: Page,
    private testName: string
  ) {}

  /**
   * Prepare the page for screenshot (hide dynamic elements, wait for stable state).
   */
  async prepare(): Promise<void> {
    await this.page.waitForLoadState('networkidle');

    // Hide elements that might cause flakiness
    await this.page.addStyleTag({
      content: `
        /* Hide animations */
        *, *::before, *::after {
          animation-duration: 0s !important;
          transition-duration: 0s !important;
        }
        /* Hide cursor */
        * { caret-color: transparent !important; }
      `,
    });

    // Wait for style changes to apply
    await this.page.evaluate(() => {
      return new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });
    });
  }

  /**
   * Take a screenshot with the test name prefix.
   */
  async screenshot(name: string, options?: Partial<ScreenshotOptions>): Promise<void> {
    await takePageScreenshot(this.page, {
      name: `${this.testName}-${name}`,
      ...options,
    });
  }

  /**
   * Take a full-page screenshot.
   */
  async fullPageScreenshot(name: string, options?: Partial<ScreenshotOptions>): Promise<void> {
    await this.screenshot(name, { ...options, fullPage: true });
  }

  /**
   * Take a screenshot of a specific element.
   */
  async elementScreenshot(
    selector: string,
    name: string,
    options?: Partial<ScreenshotOptions>
  ): Promise<void> {
    await takeElementScreenshot(this.page, selector, {
      name: `${this.testName}-${name}`,
      ...options,
    });
  }
}
