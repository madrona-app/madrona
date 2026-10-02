import { Page } from '@playwright/test';

export interface ApiError {
  url: string;
  status: number;
  statusText: string;
  method: string;
}

/**
 * Monitors API responses for errors (4xx, 5xx status codes).
 * Collects errors that can be checked at the end of a test.
 */
export class ApiErrorMonitor {
  private errors: ApiError[] = [];
  private ignoredUrls: RegExp[] = [];

  constructor(private page: Page) {}

  /**
   * Start monitoring API responses for errors.
   */
  start(): void {
    this.errors = [];
    this.page.on('response', (response) => {
      const url = response.url();
      const status = response.status();

      // Only check API calls
      if (!url.includes('/api/')) {
        return;
      }

      // Check if URL should be ignored
      if (this.ignoredUrls.some((pattern) => pattern.test(url))) {
        return;
      }

      // Collect 4xx and 5xx errors
      if (status >= 400) {
        this.errors.push({
          url,
          status,
          statusText: response.statusText(),
          method: response.request().method(),
        });
      }
    });
  }

  /**
   * Add URL patterns to ignore (for known failing endpoints).
   */
  ignoreUrls(...patterns: (string | RegExp)[]): void {
    for (const pattern of patterns) {
      if (typeof pattern === 'string') {
        this.ignoredUrls.push(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      } else {
        this.ignoredUrls.push(pattern);
      }
    }
  }

  /**
   * Get all collected errors.
   */
  getErrors(): ApiError[] {
    return [...this.errors];
  }

  /**
   * Check if any errors were collected.
   */
  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  /**
   * Get a formatted error report.
   */
  getErrorReport(): string {
    if (this.errors.length === 0) {
      return 'No API errors detected.';
    }

    const lines = [`${this.errors.length} API error(s) detected:`];
    for (const error of this.errors) {
      lines.push(`  - ${error.method} ${error.url} => ${error.status} ${error.statusText}`);
    }
    return lines.join('\n');
  }

  /**
   * Clear collected errors.
   */
  clear(): void {
    this.errors = [];
  }
}

/**
 * Create and start an API error monitor for a page.
 */
export function createApiErrorMonitor(page: Page): ApiErrorMonitor {
  const monitor = new ApiErrorMonitor(page);
  monitor.start();
  return monitor;
}
