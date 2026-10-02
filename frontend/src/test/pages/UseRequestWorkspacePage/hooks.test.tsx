import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';

import {
  useSectionSummaries,
  useHasContent,
} from '../../../pages/collections/UseRequestWorkspacePage/hooks';
import { defaultFormData } from '../../../pages/collections/UseRequestWorkspacePage/types';
import type { FormData } from '../../../pages/collections/UseRequestWorkspacePage/types';

describe('UseRequestWorkspacePage hooks', () => {
  describe('useSectionSummaries', () => {
    it('joins requester fields into a single summary', () => {
      const formData: FormData = {
        ...defaultFormData,
        requester_name: 'Alice',
        requester_institution: 'University',
        requester_email: 'alice@example.com',
      };
      const { result } = renderHook(() => useSectionSummaries(formData));
      expect(result.current.requester).toContain('Alice');
      expect(result.current.requester).toContain('University');
      expect(result.current.requester).toContain('alice@example.com');
    });

    it('includes reproduction quantity when set', () => {
      const formData: FormData = {
        ...defaultFormData,
        reproduction_type: 'photo',
        reproduction_format: 'tiff',
        reproduction_quantity: '5',
      };
      const { result } = renderHook(() => useSectionSummaries(formData));
      expect(result.current.reproduction).toContain('Qty: 5');
    });

    it('marks fees as Waived when fee_waived is true', () => {
      const formData: FormData = { ...defaultFormData, fee_waived: true };
      const { result } = renderHook(() => useSectionSummaries(formData));
      expect(result.current.fees).toContain('Waived');
    });

    it('returns undefined for empty sections', () => {
      const { result } = renderHook(() => useSectionSummaries(defaultFormData));
      expect(result.current.objects).toBeUndefined();
      expect(result.current.history).toBeUndefined();
    });
  });

  describe('useHasContent', () => {
    it('flags sections that have data', () => {
      const formData: FormData = {
        ...defaultFormData,
        requester_name: 'Alice',
        use_type: 'research',
        access_date_start: '2026-04-01',
        project_title: 'Title',
        reproduction_type: 'photo',
        exhibition_title: 'Show',
        fee_quoted: '500',
        approval_conditions: 'must credit',
      };
      const { result } = renderHook(() => useHasContent(formData));
      expect(result.current.requester).toBe(true);
      expect(result.current.details).toBe(true);
      expect(result.current.access).toBe(true);
      expect(result.current.project).toBe(true);
      expect(result.current.reproduction).toBe(true);
      expect(result.current.exhibition).toBe(true);
      expect(result.current.fees).toBe(true);
      expect(result.current.approval).toBe(true);
      expect(result.current.history).toBe(false);
    });

    it('reports false when fields are empty', () => {
      const empty: FormData = {
        ...defaultFormData,
        use_type: '',
      };
      const { result } = renderHook(() => useHasContent(empty));
      expect(result.current.requester).toBe(false);
      expect(result.current.exhibition).toBe(false);
      expect(result.current.fees).toBe(false);
    });
  });
});
