import { Page, expect, Locator } from '@playwright/test';

/**
 * Base page object with common methods for all pages.
 */
export class BasePage {
  constructor(
    protected page: Page,
    protected orgId: string
  ) {}

  /**
   * Navigate to a path, replacing :orgId placeholder.
   */
  async navigateTo(path: string): Promise<void> {
    const resolvedPath = path.replace(':orgId', this.orgId);
    await this.page.goto(resolvedPath);
    await this.waitForPageReady();
  }

  /**
   * Wait for page to be fully loaded and stable.
   */
  async waitForPageReady(): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    // Wait for any loading spinners to disappear
    const spinner = this.page.locator('[data-testid="loading-spinner"], .animate-spin');
    await spinner.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {
      // Spinner may not exist, that's fine
    });
  }

  /**
   * Click a button by its accessible name.
   */
  async clickButton(name: string | RegExp): Promise<void> {
    await this.page.getByRole('button', { name }).click();
  }

  /**
   * Fill a form field by its label.
   */
  async fillField(label: string | RegExp, value: string): Promise<void> {
    await this.page.getByLabel(label).fill(value);
  }

  /**
   * Get a form field by its label.
   */
  getField(label: string | RegExp): Locator {
    return this.page.getByLabel(label);
  }

  /**
   * Expect a toast notification with specific text.
   */
  async expectToast(text: string | RegExp): Promise<void> {
    const toast = this.page.locator('[role="alert"], [data-sonner-toast], .toast');
    await expect(toast.filter({ hasText: text })).toBeVisible({ timeout: 10000 });
  }

  /**
   * Expect no error toast to be visible.
   */
  async expectNoErrorToast(): Promise<void> {
    const errorToast = this.page.locator('[data-sonner-toast][data-type="error"]');
    await expect(errorToast).not.toBeVisible();
  }

  /**
   * Wait for navigation to complete.
   */
  async waitForNavigation(urlPattern: string | RegExp): Promise<void> {
    await this.page.waitForURL(urlPattern);
    await this.waitForPageReady();
  }

  /**
   * Check if an element is visible.
   */
  async isVisible(locator: Locator): Promise<boolean> {
    return await locator.isVisible();
  }

  /**
   * Get the current URL.
   */
  getCurrentUrl(): string {
    return this.page.url();
  }

  /**
   * Take a screenshot with the given name.
   */
  async takeScreenshot(name: string): Promise<void> {
    await this.page.screenshot({ path: `test-results/${name}.png` });
  }

  /**
   * Press keyboard key.
   */
  async pressKey(key: string): Promise<void> {
    await this.page.keyboard.press(key);
  }

  /**
   * Close any open modals by pressing Escape.
   */
  async closeModals(): Promise<void> {
    const dialog = this.getDialog();
    const wasVisible = await dialog.isVisible().catch(() => false);

    await this.page.keyboard.press('Escape');

    // If a dialog was visible, wait for it to close
    if (wasVisible) {
      await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }
  }

  /**
   * Get a dialog/modal element.
   */
  getDialog(): Locator {
    return this.page.getByRole('dialog');
  }

  /**
   * Expect dialog to be visible.
   */
  async expectDialogVisible(): Promise<void> {
    await expect(this.getDialog()).toBeVisible();
  }

  /**
   * Expect dialog to be hidden.
   */
  async expectDialogHidden(): Promise<void> {
    await expect(this.getDialog()).not.toBeVisible();
  }
}
