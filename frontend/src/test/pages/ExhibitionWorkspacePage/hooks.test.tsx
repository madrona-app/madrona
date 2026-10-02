import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';

import {
  useSectionSummaries,
  useHasContent,
} from '../../../pages/collections/ExhibitionWorkspacePage/hooks';
import { defaultFormData } from '../../../pages/collections/ExhibitionWorkspacePage/types';
import type { FormData } from '../../../pages/collections/ExhibitionWorkspacePage/types';

describe('ExhibitionWorkspacePage hooks', () => {
  describe('useSectionSummaries', () => {
    it('summarises details with title and type', () => {
      const formData: FormData = {
        ...defaultFormData,
        title: 'Spring Show',
        exhibition_type: 'temporary',
        status: 'planned',
      };
      const { result } = renderHook(() => useSectionSummaries(formData));
      expect(result.current.details).toContain('Spring Show');
    });

    it('summarises planned dates', () => {
      const formData: FormData = {
        ...defaultFormData,
        planned_start_date: '2026-05-01',
        planned_end_date: '2026-08-30',
      };
      const { result } = renderHook(() => useSectionSummaries(formData));
      expect(result.current.dates).toContain('Start: 2026-05-01');
      expect(result.current.dates).toContain('End: 2026-08-30');
    });

    it('marks publishing as Published when is_public is true', () => {
      const formData: FormData = {
        ...defaultFormData,
        is_public: true,
        public_url_slug: 'spring-show',
      };
      const { result } = renderHook(() => useSectionSummaries(formData));
      expect(result.current.public).toContain('Published');
      expect(result.current.public).toContain('spring-show');
    });

    it('returns undefined for tab-only sections', () => {
      const { result } = renderHook(() => useSectionSummaries(defaultFormData));
      expect(result.current.objects).toBeUndefined();
      expect(result.current.labels).toBeUndefined();
      expect(result.current.budget).toBeUndefined();
    });
  });

  describe('useHasContent', () => {
    it('flags details and dates when populated', () => {
      const formData: FormData = {
        ...defaultFormData,
        title: 'Show',
        planned_start_date: '2026-05-01',
        provisos: 'no flash',
        is_public: true,
        curator_notes: 'TBD',
      };
      const { result } = renderHook(() => useHasContent(formData));
      expect(result.current.details).toBe(true);
      expect(result.current.dates).toBe(true);
      expect(result.current.authorization).toBe(true);
      expect(result.current.public).toBe(true);
      expect(result.current.notes).toBe(true);
      expect(result.current.history).toBe(false);
    });

    it('reports false for tab-only sections by default', () => {
      const { result } = renderHook(() => useHasContent(defaultFormData));
      expect(result.current.objects).toBe(false);
      expect(result.current.labels).toBe(false);
      expect(result.current.discussion).toBe(false);
    });
  });
});
