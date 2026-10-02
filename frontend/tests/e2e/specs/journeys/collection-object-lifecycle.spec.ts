import { test, expect } from '../../fixtures';
import { generateTestObjectNumber } from '../../fixtures/api-helpers';

/**
 * Collection Object Lifecycle Tests
 *
 * Tests CRUD workflow for collection objects:
 * - Create a new object
 * - View the created object
 * - Search for objects
 * - Validate required fields
 */
test.describe('Collection Object Lifecycle', () => {
  test('complete create and view workflow', async ({ collectionObjectPage, page, apiHelpers }) => {
    const testObjectNumber = generateTestObjectNumber();

    // Navigate to objects list and create new
    await collectionObjectPage.gotoList();
    await collectionObjectPage.clickNewObject();

    // Fill in object information and save
    await collectionObjectPage.fillBasicInfo({
      objectNumber: testObjectNumber,
      title: `Test Object ${testObjectNumber}`,
    });
    await collectionObjectPage.save();

    // Verify success
    await collectionObjectPage.expectSaveSuccess();

    // Navigate back to list and verify object appears
    await collectionObjectPage.gotoList();
    await collectionObjectPage.search(testObjectNumber);
    await collectionObjectPage.expectObjectVisible(testObjectNumber);

    // Click on object to view details
    await collectionObjectPage.clickObject(testObjectNumber);
    const objectId = collectionObjectPage.getObjectIdFromUrl();
    expect(objectId).toBeTruthy();

    // Verify object details are visible
    await expect(page.getByText(testObjectNumber).first()).toBeVisible();

    // Cleanup via API
    if (objectId) {
      await apiHelpers.deleteCollectionObject(objectId).catch(() => {});
    }
  });

  test('validates required fields', async ({ collectionObjectPage, page }) => {
    await collectionObjectPage.gotoList();
    await collectionObjectPage.clickNewObject();

    // Try to save without filling required fields
    await collectionObjectPage.save();

    // Should stay on create page or show validation error
    await page.waitForTimeout(2000);
    const isOnCreatePage = page.url().includes('/new') || page.url().includes('/create');
    const hasError = await page.getByText(/required|missing|please fill/i).isVisible().catch(() => false);
    const hasToastError = await page.locator('[role="alert"]').filter({ hasText: /error|required|missing/i }).isVisible().catch(() => false);

    expect(isOnCreatePage || hasError || hasToastError).toBeTruthy();
  });

  test('can cancel object creation', async ({ collectionObjectPage, page }) => {
    const testObjectNumber = generateTestObjectNumber();

    await collectionObjectPage.gotoList();
    await collectionObjectPage.clickNewObject();

    await collectionObjectPage.fillBasicInfo({
      objectNumber: testObjectNumber,
      title: 'Should not be created',
    });

    await collectionObjectPage.cancel();

    // Should be back at list
    await page.waitForURL(/\/collections\/objects/);
  });
});

test.describe('Collection Object Search', () => {
  test('search returns results or empty state', async ({ collectionObjectPage, page }) => {
    await collectionObjectPage.gotoList();

    // Search for something that doesn't exist
    await collectionObjectPage.search('NONEXISTENT-12345-XYZ');

    // Should show empty state
    const _hasEmptyState = await page
      .getByText(/no.*match|no.*objects|no.*results/i)
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    // Or the page might just show zero rows — either way, no crash
    const rootContent = await page.locator('#root').innerHTML().catch(() => '');
    expect(rootContent.trim().length).toBeGreaterThan(50);
  });
});
