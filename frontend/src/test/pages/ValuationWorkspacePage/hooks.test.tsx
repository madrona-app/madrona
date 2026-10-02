import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';

import {
  useSectionSummaries,
  useHasContent,
} from '../../../pages/collections/ValuationWorkspacePage/hooks';
import { defaultFormData } from '../../../pages/collections/ValuationWorkspacePage/types';
import type { FormData } from '../../../pages/collections/ValuationWorkspacePage/types';

describe('ValuationWorkspacePage hooks', () => {
  describe('useSectionSummaries', () => {
    it('joins type, amount and date into details summary', () => {
      const formData: FormData = {
        ...defaultFormData,
        valuation_type: 'insurance',
        valuation_amount: '50000',
        valuation_currency: 'USD',
        valuation_date: '2026-04-01',
      };
      const { result } = renderHook(() => useSectionSummaries(formData));
      expect(result.current.details).toContain('insurance');
      expect(result.current.details).toContain('50000');
      expect(result.current.details).toContain('USD');
    });

    it('includes validity dates when provided', () => {
      const formData: FormData = {
        ...defaultFormData,
        valid_from: '2026-04-01',
        valid_until: '2027-04-01',
      };
      const { result } = renderHook(() => useSectionSummaries(formData));
      expect(result.current.validity).toContain('From: 2026-04-01');
      expect(result.current.validity).toContain('Until: 2027-04-01');
    });

    it('mentions the linked object when set', () => {
      const formData: FormData = {
        ...defaultFormData,
        object_id: 'abcdef12-3456-7890-abcd-ef1234567890',
      };
      const { result } = renderHook(() => useSectionSummaries(formData));
      expect(result.current.linkedObject).toContain('Object: abcdef12');
    });
  });

  describe('useHasContent', () => {
    it('flags details, valuator and validity when filled', () => {
      const formData: FormData = {
        ...defaultFormData,
        valuation_amount: '500',
        valuation_date: '2026-04-01',
        valuator_id: 'val-1',
        valid_from: '2026-04-01',
        object_id: 'obj-1',
        documentation_reference: 'ref',
        valuation_note: 'note',
      };
      const { result } = renderHook(() => useHasContent(formData));
      expect(result.current.details).toBe(true);
      expect(result.current.valuator).toBe(true);
      expect(result.current.validity).toBe(true);
      expect(result.current.linkedObject).toBe(true);
      expect(result.current.documentation).toBe(true);
      expect(result.current.notes).toBe(true);
      expect(result.current.history).toBe(false);
    });

    it('reports false for empty fields', () => {
      const { result } = renderHook(() =>
        useHasContent({
          ...defaultFormData,
          valuation_amount: '',
          valuation_date: '',
          valuation_method: '',
        }),
      );
      expect(result.current.details).toBe(false);
      expect(result.current.valuator).toBe(false);
      expect(result.current.validity).toBe(false);
      expect(result.current.linkedObject).toBe(false);
    });
  });
});
