import { test, expect } from '../../fixtures';
import { generateTestObjectNumber } from '../../fixtures/api-helpers';

/**
 * Deaccession → Object Status Tests
 *
 * Verifies that when a deaccession is completed, the linked
 * collection object's status automatically changes to "deaccessioned".
 *
 * procedure requirement: completing a deaccession must update the
 * object record to reflect it is no longer part of the collection.
 */
test.describe('Deaccession Object Status', () => {
  test('completing a deaccession sets object status to deaccessioned', async ({
    page,
    apiHelpers,
    orgId,
  }) => {
    // 1. Create a test object
    const testObjectNumber = generateTestObjectNumber();
    const object = await apiHelpers.createCollectionObject({
      object_number: testObjectNumber,
      title: `Deaccession Test Object ${testObjectNumber}`,
    });

    let deaccessionId: string | undefined;

    try {
      // 2. Create a deaccession linked to this object
      const deaccession = await apiHelpers.createDeaccession({
        object_id: object.object_id,
      });
      deaccessionId = deaccession.deaccession_id;

      // 3. Verify object status is not yet deaccessioned
      const objectBefore = (await apiHelpers.getCollectionObject(object.object_id)) as any;
      expect(objectBefore.object_status).not.toBe('deaccessioned');

      // 4. Complete the deaccession
      await apiHelpers.completeDeaccession(deaccessionId);

      // 5. Verify object status is now deaccessioned
      const objectAfter = (await apiHelpers.getCollectionObject(object.object_id)) as any;
      expect(objectAfter.object_status).toBe('deaccessioned');

      // 6. Verify in UI — the object's status renders as the selected option
      // of the "Status" <select>, not as free-standing visible text.
      await page.goto(
        `/organizations/${orgId}/collections/objects/${object.object_id}`
      );
      const statusSelect = page.getByRole('combobox', { name: 'Status' });
      await expect(statusSelect).toBeVisible({ timeout: 10000 });
      await expect(statusSelect.locator('option:checked')).toHaveText(
        /deaccessioned/i
      );
    } finally {
      if (deaccessionId) {
        await apiHelpers.deleteDeaccession(deaccessionId).catch(() => {});
      }
      await apiHelpers.deleteCollectionObject(object.object_id).catch(() => {});
    }
  });

  test('completing deaccession via PUT also sets object status', async ({
    apiHelpers,
  }) => {
    const testObjectNumber = generateTestObjectNumber();
    const object = await apiHelpers.createCollectionObject({
      object_number: testObjectNumber,
      title: `Deaccession PUT Test ${testObjectNumber}`,
    });

    let deaccessionId: string | undefined;

    try {
      // Create deaccession
      const deaccession = await apiHelpers.createDeaccession({
        object_id: object.object_id,
      });
      deaccessionId = deaccession.deaccession_id;

      // Complete via PUT (setting status directly)
      await apiHelpers.updateDeaccession(deaccessionId, { status: 'completed' });

      // Verify object status changed
      const objectAfter = (await apiHelpers.getCollectionObject(object.object_id)) as any;
      expect(objectAfter.object_status).toBe('deaccessioned');
    } finally {
      if (deaccessionId) {
        await apiHelpers.deleteDeaccession(deaccessionId).catch(() => {});
      }
      await apiHelpers.deleteCollectionObject(object.object_id).catch(() => {});
    }
  });
});
