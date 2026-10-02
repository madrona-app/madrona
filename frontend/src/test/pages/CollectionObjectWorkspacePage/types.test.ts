import { describe, it, expect } from 'vitest';
import {
  ALL_SECTION_IDS,
  CREATE_MODE_EXCLUDE,
  DEFAULT_SECTION_ORDER,
  GROUP_ORDER,
  INITIAL_EXPANDED_SECTIONS,
  NAGPRA_RELEVANT_CLASSIFICATIONS,
  OBJECT_STATUSES,
  OBJECT_TYPES,
  PAGE_SECTION_GROUPS,
  SECTION_GROUPS,
} from '../../../pages/collections/CollectionObjectWorkspacePage/types';

describe('CollectionObjectWorkspacePage / types', () => {
  describe('OBJECT_TYPES', () => {
    it('contains the canonical museum object types', () => {
      const values = OBJECT_TYPES.map((o) => o.value);
      expect(values).toContain('painting');
      expect(values).toContain('sculpture');
      expect(values).toContain('photograph');
      expect(values).toContain('print');
      expect(values).toContain('drawing');
      expect(values).toContain('textile');
      expect(values).toContain('ceramic');
      expect(values).toContain('other');
    });

    it('every entry has a label', () => {
      for (const opt of OBJECT_TYPES) {
        expect(typeof opt.label).toBe('string');
        expect(opt.label.length).toBeGreaterThan(0);
      }
    });

    it('values are unique', () => {
      const values = OBJECT_TYPES.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
    });
  });

  describe('OBJECT_STATUSES', () => {
    it('includes the procedure lifecycle statuses', () => {
      const values = OBJECT_STATUSES.map((o) => o.value);
      expect(values).toContain('accessioned');
      expect(values).toContain('active');
      expect(values).toContain('on_loan');
      expect(values).toContain('in_conservation');
      expect(values).toContain('pending');
      expect(values).toContain('deaccessioned');
      expect(values).toContain('missing');
    });
  });

  describe('NAGPRA_RELEVANT_CLASSIFICATIONS', () => {
    it('triggers NAGPRA visibility for ethnographic and natural-history terms', () => {
      expect(NAGPRA_RELEVANT_CLASSIFICATIONS.has('ethnographic')).toBe(true);
      expect(NAGPRA_RELEVANT_CLASSIFICATIONS.has('natural_history')).toBe(true);
    });

    it('does not trigger for irrelevant terms', () => {
      expect(NAGPRA_RELEVANT_CLASSIFICATIONS.has('painting')).toBe(false);
      expect(NAGPRA_RELEVANT_CLASSIFICATIONS.has('photograph')).toBe(false);
    });
  });

  describe('SECTION_GROUPS / GROUP_ORDER', () => {
    it('GROUP_ORDER lists overview, object-details, relationships, care, operations', () => {
      expect(GROUP_ORDER).toEqual([
        'overview',
        'object-details',
        'relationships',
        'care',
        'operations',
      ]);
    });

    it('every section in SECTION_GROUPS resolves to a known group', () => {
      const groups = new Set(GROUP_ORDER);
      for (const groupId of Object.values(SECTION_GROUPS)) {
        expect(groups.has(groupId)).toBe(true);
      }
    });

    it('groups core sections under their expected group', () => {
      expect(SECTION_GROUPS.media).toBe('overview');
      expect(SECTION_GROUPS.identification).toBe('overview');
      expect(SECTION_GROUPS.description).toBe('object-details');
      expect(SECTION_GROUPS.location).toBe('care');
      expect(SECTION_GROUPS.acquisition).toBe('operations');
      expect(SECTION_GROUPS.history).toBe('operations');
    });
  });

  describe('PAGE_SECTION_GROUPS', () => {
    it('matches GROUP_ORDER ids 1-to-1', () => {
      expect(PAGE_SECTION_GROUPS.map((g) => g.id)).toEqual(GROUP_ORDER);
    });

    it('overview group is expanded by default; relationships/care/operations are collapsed', () => {
      const overview = PAGE_SECTION_GROUPS.find((g) => g.id === 'overview');
      const relationships = PAGE_SECTION_GROUPS.find((g) => g.id === 'relationships');
      expect(overview?.defaultExpanded).toBe(true);
      expect(relationships?.defaultExpanded).toBe(false);
    });

    it('every group has at least one section', () => {
      for (const group of PAGE_SECTION_GROUPS) {
        expect(group.sections.length).toBeGreaterThan(0);
      }
    });

    it('marks location section required (with current_location_id)', () => {
      const care = PAGE_SECTION_GROUPS.find((g) => g.id === 'care');
      const location = care?.sections.find((s) => s.id === 'location');
      expect(location?.isRequired).toBe(true);
      expect(location?.requiredFields).toContain('current_location_id');
    });
  });

  describe('ALL_SECTION_IDS', () => {
    it('flattens all sections from PAGE_SECTION_GROUPS', () => {
      const expectedCount = PAGE_SECTION_GROUPS.reduce(
        (sum, g) => sum + g.sections.length,
        0,
      );
      expect(ALL_SECTION_IDS.length).toBe(expectedCount);
    });

    it('contains the core object sections', () => {
      expect(ALL_SECTION_IDS).toContain('identification');
      expect(ALL_SECTION_IDS).toContain('description');
      expect(ALL_SECTION_IDS).toContain('media');
      expect(ALL_SECTION_IDS).toContain('location');
      expect(ALL_SECTION_IDS).toContain('rights');
      expect(ALL_SECTION_IDS).toContain('history');
    });

    it('has no duplicates', () => {
      expect(new Set(ALL_SECTION_IDS).size).toBe(ALL_SECTION_IDS.length);
    });
  });

  describe('CREATE_MODE_EXCLUDE', () => {
    it('hides post-creation sections (events/location/valuations/procedures/parts/history)', () => {
      expect(CREATE_MODE_EXCLUDE).toContain('events');
      expect(CREATE_MODE_EXCLUDE).toContain('location');
      expect(CREATE_MODE_EXCLUDE).toContain('valuations');
      expect(CREATE_MODE_EXCLUDE).toContain('procedures');
      expect(CREATE_MODE_EXCLUDE).toContain('parts');
      expect(CREATE_MODE_EXCLUDE).toContain('history');
    });

    it('every excluded id is a real section id', () => {
      for (const id of CREATE_MODE_EXCLUDE) {
        expect(ALL_SECTION_IDS).toContain(id);
      }
    });
  });

  describe('DEFAULT_SECTION_ORDER', () => {
    it('contains an order entry for every section id', () => {
      for (const id of ALL_SECTION_IDS) {
        expect(typeof DEFAULT_SECTION_ORDER[id]).toBe('number');
      }
    });
  });

  describe('INITIAL_EXPANDED_SECTIONS', () => {
    it('starts every section collapsed (false)', () => {
      for (const id of Object.keys(INITIAL_EXPANDED_SECTIONS)) {
        expect(INITIAL_EXPANDED_SECTIONS[id]).toBe(false);
      }
    });
  });
});
