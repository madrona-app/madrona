/**
 * Tests for the pure hooks in CollectionObjectWorkspacePage/hooks.ts:
 * - useHasContent — derives section "has content" booleans
 * - useSectionSummaries — builds collapsed-card hint strings
 *
 * The data-fetching/form-state hooks (useCollectionObjectData, useFormState,
 * useSectionState) require routing context + react-query and are exercised
 * through the section components / index integration tests.
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useHasContent,
  useSectionSummaries,
} from '../../../pages/collections/CollectionObjectWorkspacePage/hooks';
import { makeCollectionObject, mockEmptyObject } from './fixtures';

describe('useHasContent', () => {
  it('marks identification true even with an empty object (object_number is required)', () => {
    const { result } = renderHook(() => useHasContent(mockEmptyObject()));
    expect(result.current.identification).toBe(true);
  });

  it('treats an empty object as having no description / physical / location data', () => {
    const { result } = renderHook(() => useHasContent(mockEmptyObject()));
    expect(result.current.description).toBe(false);
    expect(result.current.physical).toBe(false);
    expect(result.current.location).toBe(false);
    expect(result.current.condition).toBe(false);
  });

  it('detects description content from any of the description fields', () => {
    const obj = makeCollectionObject({ brief_description: 'A description' });
    const { result } = renderHook(() => useHasContent(obj));
    expect(result.current.description).toBe(true);
  });

  it('detects physical content from material/technique counts', () => {
    const obj = makeCollectionObject({ material_count: 2, technique_count: 0 });
    const { result } = renderHook(() => useHasContent(obj));
    expect(result.current.physical).toBe(true);
  });

  it('detects physical content from measurements array', () => {
    const obj = makeCollectionObject({
      material_count: 0,
      technique_count: 0,
      measurements: [{ dimension: 'height', value: 10, unit: 'cm', part: null }] as never,
    });
    const { result } = renderHook(() => useHasContent(obj));
    expect(result.current.physical).toBe(true);
  });

  it('detects condition content from condition_note', () => {
    const obj = makeCollectionObject({ condition_note: 'Stable' });
    const { result } = renderHook(() => useHasContent(obj));
    expect(result.current.condition).toBe(true);
  });

  it('detects location content when current_location_id is set', () => {
    const obj = makeCollectionObject({ current_location_id: 'loc-1' });
    const { result } = renderHook(() => useHasContent(obj));
    expect(result.current.location).toBe(true);
  });

  it('detects acquisition content from any of the acquisition fields', () => {
    const obj = makeCollectionObject({ acquisition_method: 'gift' });
    const { result } = renderHook(() => useHasContent(obj));
    expect(result.current.acquisition).toBe(true);
  });

  it('detects valuations content from valuationsData length', () => {
    const obj = makeCollectionObject();
    const { result } = renderHook(() =>
      useHasContent(obj, [], [{ valuation_id: 'v-1' } as never], []),
    );
    expect(result.current.valuations).toBe(true);
  });

  it('detects rights content from rightsData length', () => {
    const obj = makeCollectionObject();
    const { result } = renderHook(() =>
      useHasContent(obj, [], [], [{ right_id: 'r-1' } as never]),
    );
    expect(result.current.rights).toBe(true);
  });

  it('detects media content from linkedMedia length', () => {
    const obj = makeCollectionObject();
    const { result } = renderHook(() =>
      useHasContent(obj, [{ media_id: 'm-1' } as never], [], []),
    );
    expect(result.current.media).toBe(true);
  });

  it('marks parts true only when there is more than one part', () => {
    const oneObj = makeCollectionObject({
      parts: [{ part_id: 'p-1' } as never],
    });
    const twoObj = makeCollectionObject({
      parts: [{ part_id: 'p-1' } as never, { part_id: 'p-2' } as never],
    });
    expect(renderHook(() => useHasContent(oneObj)).result.current.parts).toBe(false);
    expect(renderHook(() => useHasContent(twoObj)).result.current.parts).toBe(true);
  });

  it('returns history=true unconditionally', () => {
    const { result } = renderHook(() => useHasContent(mockEmptyObject()));
    expect(result.current.history).toBe(true);
  });

  it('returns events=false (events are self-fetched)', () => {
    const { result } = renderHook(() => useHasContent(makeCollectionObject()));
    expect(result.current.events).toBe(false);
  });
});

describe('useSectionSummaries', () => {
  it('returns an empty object when there is no object yet', () => {
    const { result } = renderHook(() =>
      useSectionSummaries(undefined, [], [], null, []),
    );
    expect(result.current).toEqual({});
  });

  it('builds an identification hint of "Type · Number · Status"', () => {
    const obj = makeCollectionObject({
      object_type: 'painting',
      object_number: '2024.005',
      object_status: 'accessioned',
    });
    const { result } = renderHook(() => useSectionSummaries(obj, [], [], null, []));
    expect(result.current.identification).toContain('Painting');
    expect(result.current.identification).toContain('2024.005');
    expect(result.current.identification).toContain('Accessioned');
  });

  it('truncates long brief descriptions for the description hint', () => {
    const long = 'a'.repeat(120);
    const obj = makeCollectionObject({ brief_description: long });
    const { result } = renderHook(() => useSectionSummaries(obj, [], [], null, []));
    expect(result.current.description?.length).toBeLessThanOrEqual(61);
    expect(result.current.description?.endsWith('…')).toBe(true);
  });

  it('does not truncate short brief descriptions', () => {
    const obj = makeCollectionObject({ brief_description: 'Short.' });
    const { result } = renderHook(() => useSectionSummaries(obj, [], [], null, []));
    expect(result.current.description).toBe('Short.');
  });

  it('builds a physical hint with material/technique counts', () => {
    const obj = makeCollectionObject({
      material_count: 3,
      technique_count: 1,
      measurements: [],
    });
    const { result } = renderHook(() => useSectionSummaries(obj, [], [], null, []));
    expect(result.current.physical).toContain('3 materials');
    expect(result.current.physical).toContain('1 technique');
  });

  it('returns an undefined media hint when no media is linked', () => {
    const obj = makeCollectionObject();
    const { result } = renderHook(() => useSectionSummaries(obj, [], [], null, []));
    expect(result.current.media).toBeUndefined();
  });

  it('returns "1 image" for one piece of media (singular)', () => {
    const obj = makeCollectionObject();
    const { result } = renderHook(() =>
      useSectionSummaries(obj, [{ media_id: 'm-1' } as never], [], null, []),
    );
    expect(result.current.media).toBe('1 image');
  });

  it('returns "2 images" for multiple pieces of media (plural)', () => {
    const obj = makeCollectionObject();
    const { result } = renderHook(() =>
      useSectionSummaries(
        obj,
        [{ media_id: 'm-1' } as never, { media_id: 'm-2' } as never],
        [],
        null,
        [],
      ),
    );
    expect(result.current.media).toBe('2 images');
  });

  it('formats current valuation as currency when there is a current entry', () => {
    const obj = makeCollectionObject();
    const valuations = [
      {
        valuation_id: 'v-1',
        valuation_amount: 5000,
        valuation_currency: 'USD',
        is_current: true,
        valuation_type: 'insurance',
      },
    ] as never[];
    const { result } = renderHook(() =>
      useSectionSummaries(obj, [], valuations, null, []),
    );
    expect(result.current.valuations).toMatch(/\$5,000/);
  });

  it('falls back to "{n} valuations" when no current entry is present', () => {
    const obj = makeCollectionObject();
    const valuations = [
      {
        valuation_id: 'v-1',
        valuation_amount: 1,
        valuation_currency: 'USD',
        is_current: false,
        valuation_type: 'insurance',
      },
      {
        valuation_id: 'v-2',
        valuation_amount: 2,
        valuation_currency: 'USD',
        is_current: false,
        valuation_type: 'insurance',
      },
    ] as never[];
    const { result } = renderHook(() =>
      useSectionSummaries(obj, [], valuations, null, []),
    );
    expect(result.current.valuations).toBe('2 valuations');
  });

  it('reports unresolved rights count when rights have unresolved statuses', () => {
    const obj = makeCollectionObject();
    const rights = [
      { right_id: 'r-1', status: 'unknown' },
      { right_id: 'r-2', status: 'cleared' },
      { right_id: 'r-3', status: 'orphan' },
    ];
    const { result } = renderHook(() =>
      useSectionSummaries(obj, [], [], null, rights),
    );
    expect(result.current.rights).toBe('2 unresolved');
  });

  it('reports total rights count when all are resolved', () => {
    const obj = makeCollectionObject();
    const rights = [
      { right_id: 'r-1', status: 'cleared' },
      { right_id: 'r-2', status: 'cleared' },
    ];
    const { result } = renderHook(() =>
      useSectionSummaries(obj, [], [], null, rights),
    );
    expect(result.current.rights).toBe('2 rights');
  });

  it('builds a location hint from the current_location path/name', () => {
    const obj = makeCollectionObject({
      current_location: {
        location_id: 'loc-1',
        name: 'Gallery A',
        path: 'Building / Gallery A',
        location_type: 'gallery',
        on_display: true,
      },
    });
    const { result } = renderHook(() => useSectionSummaries(obj, [], [], null, []));
    expect(result.current.location).toBe('Current: Building / Gallery A');
  });

  it('falls back to "Location unknown" when there is no current location', () => {
    const obj = makeCollectionObject({
      current_location: null,
      parts: [],
    });
    const { result } = renderHook(() => useSectionSummaries(obj, [], [], null, []));
    expect(result.current.location).toBe('Location unknown');
  });

  it('reports parts located ratio when the object has multiple parts and no current_location', () => {
    const obj = makeCollectionObject({
      current_location: null,
      parts: [
        { part_id: 'p-1', current_location_id: 'loc-1' } as never,
        { part_id: 'p-2', current_location_id: null } as never,
        { part_id: 'p-3', current_location_id: 'loc-2' } as never,
      ],
    });
    const { result } = renderHook(() => useSectionSummaries(obj, [], [], null, []));
    expect(result.current.location).toBe('2/3 parts located');
  });

  it('builds an acquisition hint from method + year', () => {
    const obj = makeCollectionObject({
      acquisition_method: 'gift',
      acquisition_date: '2020-06-15',
    });
    const { result } = renderHook(() => useSectionSummaries(obj, [], [], null, []));
    expect(result.current.acquisition).toContain('Gift');
    expect(result.current.acquisition).toContain('2020');
  });

  it('builds a condition hint from the latest report date', () => {
    const obj = makeCollectionObject();
    const procedures = {
      condition_reports: [
        { report_date: '2023-01-01' },
        { report_date: '2024-04-15' },
      ],
    };
    const { result } = renderHook(() =>
      useSectionSummaries(obj, [], [], procedures, []),
    );
    expect(result.current.condition).toMatch(/^Last:/);
  });

  it('returns "No assessment" when there are no condition reports', () => {
    const obj = makeCollectionObject();
    const { result } = renderHook(() =>
      useSectionSummaries(obj, [], [], { condition_reports: [] }, []),
    );
    expect(result.current.condition).toBe('No assessment');
  });
});
