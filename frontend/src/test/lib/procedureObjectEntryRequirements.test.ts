/**
 * Tests for Object Entry Requirements
 * (Requirements engine derived from organization procedures)
 */

import { describe, it, expect } from 'vitest';
import {
  computeProcedureCompliance,
  canTransitionTo,
  getNextStatus,
  type EntryStatus,
} from '../../lib/procedureObjectEntryRequirements';

// =============================================================================
// TEST FIXTURES
// =============================================================================

const createBaseEntry = (): Record<string, unknown> => ({
  entry_number: '',
  entry_date: '',
  entry_reason: '',
  depositor_id: '',
  current_owner_id: '',
  objects_description: '',
  items: [],
  media_count: 0,
  expected_duration: '',
  expected_return_date: '',
  conditions: '',
  insurance_value: '',
  insurance_currency: 'USD',
  insurance_note: '',
  terms_accepted: false,
  terms_accepted_date: '',
  terms_accepted_by: '',
  acceptance_method: '',
  signature_reference: '',
  receipt_reference: '',
});

const createCompleteEntry = (): Record<string, unknown> => ({
  entry_number: 'ENT-2026-001',
  entry_date: '2026-02-04',
  entry_reason: 'loan_consideration',
  depositor_id: 'DEP-001',
  current_owner_id: 'OWN-001',
  objects_description: 'Collection of 5 oil paintings from the 19th century',
  items: [
    { id: 'i1', location_id: 'LOC-001' },
    { id: 'i2', location_id: 'LOC-001' },
  ],
  media_count: 3,
  expected_duration: '3_months',
  expected_return_date: '2026-05-04',
  conditions: 'Climate controlled storage required',
  insurance_value: 50000,
  insurance_currency: 'USD',
  insurance_note: 'Covered by museum policy',
  terms_accepted: true,
  terms_accepted_date: '2026-02-04',
  terms_accepted_by: 'John Smith',
  acceptance_method: 'signature',
  signature_reference: 'SIG-2026-001',
  receipt_reference: 'REC-2026-001',
});

const createPartialEntry = (): Record<string, unknown> => ({
  ...createBaseEntry(),
  entry_number: 'ENT-2026-002',
  entry_date: '2026-02-04',
  entry_reason: 'gift_offer',
  depositor_id: 'DEP-002',
  objects_description: 'Bronze sculpture',
  items: [{ id: 'i1' }],
});

const createEntryMissingTerms = (): Record<string, unknown> => ({
  ...createCompleteEntry(),
  terms_accepted: false,
  terms_accepted_date: '',
  terms_accepted_by: '',
});

// =============================================================================
// TESTS: computeProcedureCompliance
// =============================================================================

describe('computeProcedureCompliance', () => {
  describe('with fully complete entry', () => {
    it('should return 100% completion', () => {
      const entry = createCompleteEntry();
      const result = computeProcedureCompliance(entry, 'pending');

      expect(result.percentComplete).toBe(100);
      expect(result.blockingMissing).toHaveLength(0);
      expect(result.recommendedMissing).toHaveLength(0);
    });

    it('should have all groups complete', () => {
      const entry = createCompleteEntry();
      const result = computeProcedureCompliance(entry, 'pending');

      for (const group of result.groups) {
        expect(group.completedCount).toBe(group.totalCount);
        expect(group.missingLabels).toHaveLength(0);
      }
    });

    it('should have no blocking requirements for any transition', () => {
      const entry = createCompleteEntry();
      const statuses: EntryStatus[] = ['received', 'processed', 'returned'];

      for (const status of statuses) {
        const result = computeProcedureCompliance(entry, 'pending', status);
        expect(result.blockingMissing).toHaveLength(0);
      }
    });
  });

  describe('with empty entry', () => {
    it('should return low completion percentage', () => {
      const entry = createBaseEntry();
      const result = computeProcedureCompliance(entry, 'pending');

      expect(result.percentComplete).toBeLessThan(50);
      expect(result.requiredComplete).toBeLessThan(result.requiredTotal);
    });

    it('should identify blocking requirements for received status', () => {
      const entry = createBaseEntry();
      const result = computeProcedureCompliance(entry, 'pending', 'received');

      expect(result.blockingMissing.length).toBeGreaterThan(0);

      const blockingIds = result.blockingMissing.map(r => r.requirement.id);
      expect(blockingIds).toContain('entry_number');
      expect(blockingIds).toContain('entry_date');
      expect(blockingIds).toContain('depositor_id');
      expect(blockingIds).toContain('objects_description');
    });
  });

  describe('with missing Terms accepted (blocks Returned)', () => {
    it('should identify terms_accepted as blocking for processed', () => {
      const entry = createEntryMissingTerms();
      const result = computeProcedureCompliance(entry, 'received', 'processed');

      const blockingIds = result.blockingMissing.map(r => r.requirement.id);
      expect(blockingIds).toContain('terms_accepted');
    });

    it('should identify terms_accepted as blocking for returned', () => {
      const entry = createEntryMissingTerms();
      const result = computeProcedureCompliance(entry, 'processed', 'returned');

      const blockingIds = result.blockingMissing.map(r => r.requirement.id);
      expect(blockingIds).toContain('terms_accepted');
    });

    it('should NOT block received status', () => {
      const entry = createEntryMissingTerms();
      const result = computeProcedureCompliance(entry, 'pending', 'received');

      const blockingIds = result.blockingMissing.map(r => r.requirement.id);
      expect(blockingIds).not.toContain('terms_accepted');
    });
  });

  describe('with conditional insurance requirement', () => {
    it('should not require insurance value when insurance_applicable is false', () => {
      const entry: Record<string, unknown> = {
        ...createPartialEntry(),
        insurance_applicable: false,
        insurance_value: '',
      };

      const result = computeProcedureCompliance(entry, 'received', 'processed');

      // Insurance value should be satisfied (skipped) when not applicable
      const insuranceGroup = result.groups.find(g => g.group.id === 'insurance');
      const insuranceValueResult = insuranceGroup?.results.find(
        r => r.requirement.id === 'insurance_value'
      );

      expect(insuranceValueResult?.satisfied).toBe(true);
    });

    it('should check insurance value when insurance_applicable is not explicitly false', () => {
      const entry: Record<string, unknown> = {
        ...createPartialEntry(),
        insurance_value: '',
        // insurance_applicable not set (undefined)
      };

      const result = computeProcedureCompliance(entry, 'received', 'processed');

      const insuranceGroup = result.groups.find(g => g.group.id === 'insurance');
      const insuranceValueResult = insuranceGroup?.results.find(
        r => r.requirement.id === 'insurance_value'
      );

      // Should be unsatisfied when value is empty and applicable
      expect(insuranceValueResult?.satisfied).toBe(false);
    });
  });

  describe('nextBlockingField', () => {
    it('should return the first blocking field for navigation', () => {
      const entry = createBaseEntry();
      const result = computeProcedureCompliance(entry, 'pending', 'received');

      expect(result.nextBlockingField).not.toBeNull();
      expect(result.nextBlockingField?.sectionId).toBeTruthy();
      expect(result.nextBlockingField?.fieldPath).toBeTruthy();
    });

    it('should return null when no blocking fields exist', () => {
      const entry = createCompleteEntry();
      const result = computeProcedureCompliance(entry, 'pending', 'received');

      expect(result.nextBlockingField).toBeNull();
    });
  });
});

// =============================================================================
// TESTS: canTransitionTo
// =============================================================================

describe('canTransitionTo', () => {
  it('should allow transition to received with minimal required fields', () => {
    const entry: Record<string, unknown> = {
      entry_number: 'ENT-2026-001',
      entry_date: '2026-02-04',
      entry_reason: 'loan_consideration',
      depositor_id: 'DEP-001',
      objects_description: 'Oil painting',
      items: [{ id: 'i1' }],
    };

    const result = canTransitionTo(entry, 'pending', 'received');

    expect(result.allowed).toBe(true);
    expect(result.blockingRequirements).toHaveLength(0);
  });

  it('should block transition to processed without terms_accepted', () => {
    const entry: Record<string, unknown> = {
      entry_number: 'ENT-2026-001',
      entry_date: '2026-02-04',
      entry_reason: 'loan_consideration',
      depositor_id: 'DEP-001',
      objects_description: 'Oil painting',
      items: [{ id: 'i1' }],
      terms_accepted: false,
    };

    const result = canTransitionTo(entry, 'received', 'processed');

    expect(result.allowed).toBe(false);
    expect(result.blockingRequirements.length).toBeGreaterThan(0);

    const blockingIds = result.blockingRequirements.map(r => r.requirement.id);
    expect(blockingIds).toContain('terms_accepted');
  });

  it('should allow transition to processed with all requirements met', () => {
    const entry = createCompleteEntry();
    const result = canTransitionTo(entry, 'received', 'processed');

    expect(result.allowed).toBe(true);
    expect(result.blockingRequirements).toHaveLength(0);
  });
});

// =============================================================================
// TESTS: getNextStatus
// =============================================================================

describe('getNextStatus', () => {
  it('should return received for pending', () => {
    expect(getNextStatus('pending')).toBe('received');
  });

  it('should return processed for received', () => {
    expect(getNextStatus('received')).toBe('processed');
  });

  it('should return null for processed (multiple outcomes)', () => {
    expect(getNextStatus('processed')).toBeNull();
  });

  it('should return null for terminal statuses', () => {
    expect(getNextStatus('returned')).toBeNull();
    expect(getNextStatus('acquired')).toBeNull();
  });
});

// =============================================================================
// TESTS: Group completeness
// =============================================================================

describe('group completeness tracking', () => {
  it('should track completion per group', () => {
    const entry = createPartialEntry();
    const result = computeProcedureCompliance(entry, 'pending');

    // Entry group should be mostly complete
    const entryGroup = result.groups.find(g => g.group.id === 'entry');
    expect(entryGroup).toBeDefined();
    expect(entryGroup!.completedCount).toBeGreaterThan(0);

    // Terms group - terms_accepted should be incomplete, but conditional fields
    // (accepted_date, accepted_by) are "satisfied" when terms not accepted
    const termsGroup = result.groups.find(g => g.group.id === 'terms-acceptance');
    expect(termsGroup).toBeDefined();
    // The blocking requirement (terms_accepted) should be missing
    const termsAccepted = termsGroup!.results.find(r => r.requirement.id === 'terms_accepted');
    expect(termsAccepted?.satisfied).toBe(false);
  });

  it('should provide missing labels for incomplete groups', () => {
    const entry = createBaseEntry();
    const result = computeProcedureCompliance(entry, 'pending');

    const entryGroup = result.groups.find(g => g.group.id === 'entry');
    expect(entryGroup).toBeDefined();
    expect(entryGroup!.missingLabels.length).toBeGreaterThan(0);
    expect(entryGroup!.missingLabels).toContain('Entry number');
  });
});
