import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';

import {
  useSectionSummaries,
  useHasContent,
} from '../../../pages/collections/InsuranceWorkspacePage/hooks';
import { defaultFormData } from '../../../pages/collections/InsuranceWorkspacePage/types';
import type { FormData } from '../../../pages/collections/InsuranceWorkspacePage/types';

describe('InsuranceWorkspacePage hooks', () => {
  describe('useSectionSummaries', () => {
    it('builds a details summary from policy fields', () => {
      const formData: FormData = {
        ...defaultFormData,
        policy_number: 'POL-1',
        policy_type: 'blanket',
        status: 'active',
      };
      const { result } = renderHook(() => useSectionSummaries(formData));
      expect(result.current.details).toContain('POL-1');
    });

    it('returns provider summary when provider_name is set', () => {
      const formData: FormData = { ...defaultFormData, provider_name: 'AIG' };
      const { result } = renderHook(() => useSectionSummaries(formData));
      expect(result.current.provider).toContain('AIG');
    });

    it('returns coverage summary with limit and currency', () => {
      const formData: FormData = {
        ...defaultFormData,
        coverage_limit: '1000000',
        coverage_limit_currency: 'USD',
      };
      const { result } = renderHook(() => useSectionSummaries(formData));
      expect(result.current.coverage).toContain('1000000');
      expect(result.current.coverage).toContain('USD');
    });

    it('returns dates summary when dates are set', () => {
      const formData: FormData = {
        ...defaultFormData,
        effective_date: '2026-01-01',
        expiration_date: '2026-12-31',
      };
      const { result } = renderHook(() => useSectionSummaries(formData));
      expect(result.current.dates).toContain('2026-01-01');
      expect(result.current.dates).toContain('2026-12-31');
    });

    it('truncates long notes', () => {
      const long = 'a'.repeat(120);
      const formData: FormData = { ...defaultFormData, notes: long };
      const { result } = renderHook(() => useSectionSummaries(formData));
      expect((result.current.notes ?? '').endsWith('…')).toBe(true);
    });
  });

  describe('useHasContent', () => {
    it('reports presence of details and provider sections', () => {
      const formData: FormData = {
        ...defaultFormData,
        policy_number: 'POL-1',
        provider_name: 'AIG',
        coverage_limit: '100000',
        effective_date: '2026-01-01',
        notes: 'note',
      };
      const { result } = renderHook(() => useHasContent(formData));
      expect(result.current.details).toBe(true);
      expect(result.current.provider).toBe(true);
      expect(result.current.coverage).toBe(true);
      expect(result.current.dates).toBe(true);
      expect(result.current.notes).toBe(true);
      expect(result.current.coveredItems).toBe(false);
      expect(result.current.history).toBe(false);
    });

    it('reports false when fields are blank', () => {
      const formData: FormData = {
        ...defaultFormData,
        policy_number: '',
        policy_name: '',
        policy_type: '',
        provider_name: '',
        broker_name: '',
        coverage_limit: '',
        per_occurrence_limit: '',
        deductible: '',
        annual_premium: '',
        effective_date: '',
        expiration_date: '',
        notes: '',
      };
      const { result } = renderHook(() => useHasContent(formData));
      expect(result.current.details).toBe(false);
      expect(result.current.provider).toBe(false);
      expect(result.current.coverage).toBe(false);
      expect(result.current.dates).toBe(false);
      expect(result.current.notes).toBe(false);
    });
  });
});
