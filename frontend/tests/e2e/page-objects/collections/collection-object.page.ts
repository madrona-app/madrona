import { expect } from '@playwright/test';
import { BasePage } from '../base.page';

export interface CollectionObjectData {
  objectNumber: string;
  title?: string;
  objectType?: string;
  description?: string;
}

/**
 * Page object for Collection Object CRUD operations.
 */
export class CollectionObjectPage extends BasePage {
  private basePath = '/organizations/:orgId/collections/objects';

  /**
   * Navigate to the objects list page.
   */
  async gotoList(): Promise<void> {
    await this.navigateTo(this.basePath);
  }

  /**
   * Navigate to create a new object.
   */
  async gotoCreate(): Promise<void> {
    await this.navigateTo(`${this.basePath}/new`);
  }

  /**
   * Navigate to edit an existing object.
   */
  async gotoEdit(objectId: string): Promise<void> {
    await this.navigateTo(`${this.basePath}/${objectId}/edit`);
  }

  /**
   * Navigate to view an existing object.
   */
  async gotoView(objectId: string): Promise<void> {
    await this.navigateTo(`${this.basePath}/${objectId}`);
  }

  /**
   * Fill in basic object information.
   */
  async fillBasicInfo(data: CollectionObjectData): Promise<void> {
    // Expand the Identification section by clicking on it
    const identSection = this.page.getByText('Identification').first();
    await identSection.waitFor({ state: 'visible', timeout: 5000 });
    await identSection.click();
    await this.page.waitForTimeout(1000);

    // If section didn't expand (no input visible), try clicking parent button/div
    let objectNumberInput = this.page.locator('input[type="text"]').first();
    if (!await objectNumberInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Try clicking the section card itself
      await this.page.locator('button, [role="button"], div[class*="cursor"]')
        .filter({ hasText: 'Identification' })
        .first()
        .click();
      await this.page.waitForTimeout(1000);
    }

    objectNumberInput = this.page.locator('input[type="text"]').first();
    await objectNumberInput.fill(data.objectNumber);

    // Fill optional title if provided
    if (data.title) {
      const titleInput = this.page.locator('input[type="text"]').nth(1);
      if (await titleInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await titleInput.fill(data.title);
      }
    }

    if (data.objectType) {
      // Object type might be a select/combobox
      const objectTypeField = this.page.getByLabel(/object type/i);
      if (await objectTypeField.isVisible()) {
        await objectTypeField.click();
        await this.page.getByRole('option', { name: data.objectType }).click();
      }
    }

    if (data.description) {
      // Description field may not exist on all forms - check first
      const descField = this.page.getByLabel(/description/i);
      if (await descField.isVisible().catch(() => false)) {
        await descField.fill(data.description);
      }
    }
  }

  /**
   * Save/finish editing the object.
   * - On NEW page: clicks "Create Object" button
   * - On EDIT page: waits for auto-save, then clicks "Done"
   */
  async save(): Promise<void> {
    const createBtn = this.page.getByRole('button', { name: /create object/i });
    const doneBtn = this.page.getByRole('button', { name: /done/i });

    // Check if we're on the create page (has "Create Object" button)
    if (await createBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await createBtn.click();
      await this.waitForPageReady();
    } else if (await doneBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      // On edit page - wait for auto-save then click Done
      await this.page.waitForSelector('text=/saved/i', { timeout: 10000 }).catch(() => {});
      await doneBtn.click();
      await this.waitForPageReady();
    }
  }

  /**
   * Click Create Object button (for new objects).
   */
  async create(): Promise<void> {
    await this.page.getByRole('button', { name: /create object/i }).click();
    await this.waitForPageReady();
  }

  /**
   * Click the delete button and confirm.
   */
  async delete(): Promise<void> {
    await this.clickButton(/delete/i);
    // Wait for confirmation dialog
    await this.expectDialogVisible();
    // Confirm deletion
    await this.page
      .getByRole('dialog')
      .getByRole('button', { name: /delete|confirm|yes/i })
      .click();
    await this.waitForPageReady();
  }

  /**
   * Click cancel/back to return to the list.
   * Uses "Back to Collection" link or "Cancel" button.
   */
  async cancel(): Promise<void> {
    const backLink = this.page.getByRole('link', { name: /back to collection/i });
    const cancelBtn = this.page.getByRole('button', { name: /cancel/i });

    if (await backLink.isVisible()) {
      await backLink.click();
    } else {
      await cancelBtn.click();
    }
  }

  /**
   * Click the "Create Object" link/button to start creating.
   */
  async clickNewObject(): Promise<void> {
    // Button text is "New Object" or "Create Object" depending on viewport
    await this.page
      .getByRole('link', { name: /new object|create object/i })
      .click();
    await this.waitForPageReady();
  }

  /**
   * Expect an object to be visible in the list.
   */
  async expectObjectVisible(objectNumber: string): Promise<void> {
    await expect(this.page.getByText(objectNumber).first()).toBeVisible();
  }

  /**
   * Expect an object to not be visible in the list.
   */
  async expectObjectNotVisible(objectNumber: string): Promise<void> {
    // Use count() check since .first().not.toBeVisible() can be tricky
    await expect(this.page.getByText(objectNumber)).toHaveCount(0);
  }

  /**
   * Search for an object.
   */
  async search(query: string): Promise<void> {
    const searchInput = this.page.getByPlaceholder(/search/i);
    await searchInput.fill(query);
    await this.page.keyboard.press('Enter');
    await this.waitForPageReady();
  }

  /**
   * Click on an object row to view details.
   */
  async clickObject(objectNumber: string): Promise<void> {
    await this.page.getByText(objectNumber).click();
    await this.waitForPageReady();
  }

  /**
   * Get the object ID from the current URL (for edit/view pages).
   */
  getObjectIdFromUrl(): string | null {
    const url = this.getCurrentUrl();
    const match = url.match(/\/objects\/([^/]+)/);
    return match ? match[1] : null;
  }

  /**
   * Expect form validation error.
   */
  async expectValidationError(message: string | RegExp): Promise<void> {
    await expect(this.page.getByText(message)).toBeVisible();
  }

  /**
   * Expect success after save - check for toast OR inline "Saved" indicator.
   */
  async expectSaveSuccess(): Promise<void> {
    // Success signal is either a toast, "Saved" indicator, or redirect to detail page
    const toast = this.page.locator('[role="alert"], [data-sonner-toast], .toast').filter({ hasText: /saved|created|success/i });
    const savedIndicator = this.page.getByText(/saved/i);
    const onDetailPage = this.page.url().match(/\/objects\/[a-f0-9-]+/);

    if (onDetailPage) return; // Redirect to detail = success

    await expect(toast.or(savedIndicator).first()).toBeVisible({ timeout: 10000 });
  }

  /**
   * Expect success message after delete.
   */
  async expectDeleteSuccess(): Promise<void> {
    await this.expectToast(/deleted|removed|success/i);
  }

  /**
   * Get all visible objects in the list.
   */
  async getVisibleObjects(): Promise<string[]> {
    const rows = await this.page.locator('table tbody tr, [data-testid="object-row"]').all();
    const objects: string[] = [];
    for (const row of rows) {
      const text = await row.textContent();
      if (text) {
        objects.push(text);
      }
    }
    return objects;
  }
}
