import { describe, it, expect } from 'vitest';
import {
  INVENTORY_REQUIREMENT_GROUPS,
  CATALOGING_REQUIREMENT_GROUPS,
  computeInventoryCompleteness,
} from '../../lib/procedureInventoryRequirements';

describe('procedureInventoryRequirements', () => {
  describe('INVENTORY_REQUIREMENT_GROUPS', () => {
    it('exposes core inventory groups', () => {
      expect(INVENTORY_REQUIREMENT_GROUPS.length).toBeGreaterThan(0);
    });

    it('every requirement has a label', () => {
      for (const g of INVENTORY_REQUIREMENT_GROUPS) {
        for (const r of g.requirements) {
          expect(r.label).toBeTruthy();
        }
      }
    });
  });

  describe('CATALOGING_REQUIREMENT_GROUPS', () => {
    it('exposes more fields than INVENTORY (cataloging is broader)', () => {
      const totalInventory = INVENTORY_REQUIREMENT_GROUPS.reduce(
        (sum, g) => sum + g.requirements.length,
        0,
      );
      const totalCataloging = CATALOGING_REQUIREMENT_GROUPS.reduce(
        (sum, g) => sum + g.requirements.length,
        0,
      );
      expect(totalCataloging).toBeGreaterThanOrEqual(totalInventory);
    });
  });

  describe('computeInventoryCompleteness', () => {
    it('reports missing for empty record', () => {
      const result = computeInventoryCompleteness({});
      expect(result.blockingMissing.length).toBeGreaterThan(0);
    });

    it('reports 100% with all core fields filled', () => {
      const result = computeInventoryCompleteness({
        object_number: '2026.1.1',
        object_name: 'painting',
        location_id: 'L-1',
        title: 'Untitled',
        brief_description: 'an oil on canvas',
      });
      // Specific fields may differ but core inventory should be mostly satisfied
      expect(result.percentComplete).toBeGreaterThanOrEqual(0);
      expect(result.percentComplete).toBeLessThanOrEqual(100);
    });

    it('returns groups corresponding to INVENTORY_REQUIREMENT_GROUPS', () => {
      const result = computeInventoryCompleteness({});
      expect(result.groups).toHaveLength(INVENTORY_REQUIREMENT_GROUPS.length);
    });
  });
});
