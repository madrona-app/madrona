import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';

import {
  useSectionSummaries,
  useHasContent,
} from '../../../pages/collections/RightWorkspacePage/hooks';
import { defaultFormData } from '../../../pages/collections/RightWorkspacePage/types';
import type { FormData } from '../../../pages/collections/RightWorkspacePage/types';

describe('RightWorkspacePage hooks', () => {
  describe('useSectionSummaries', () => {
    it('builds the details summary from right_type, subtype, status', () => {
      const formData: FormData = {
        ...defaultFormData,
        right_type: 'copyright',
        status: 'active',
      };
      const { result } = renderHook(() => useSectionSummaries(formData));
      expect(result.current.details).toContain('copyright');
      expect(result.current.details).toContain('active');
    });

    it('says "Perpetual" in duration when is_perpetual is set', () => {
      const formData: FormData = {
        ...defaultFormData,
        is_perpetual: true,
      };
      const { result } = renderHook(() => useSectionSummaries(formData));
      expect(result.current.duration).toContain('Perpetual');
    });

    it('formats fees when fee_required is true', () => {
      const formData: FormData = {
        ...defaultFormData,
        fee_required: true,
        fee_amount: '500',
        fee_currency: 'USD',
      };
      const { result } = renderHook(() => useSectionSummaries(formData));
      expect(result.current.fees).toContain('500 USD');
    });

    it('mentions orphan work when flagged', () => {
      const formData: FormData = {
        ...defaultFormData,
        is_orphan_work: true,
        due_diligence_conducted: true,
      };
      const { result } = renderHook(() => useSectionSummaries(formData));
      expect(result.current.orphan).toContain('Orphan work');
      expect(result.current.orphan).toContain('Due diligence');
    });

    it('truncates long agreement references', () => {
      const long = 'agreement '.repeat(20);
      const formData: FormData = {
        ...defaultFormData,
        agreement_reference: long,
      };
      const { result } = renderHook(() => useSectionSummaries(formData));
      expect((result.current.notes ?? '').endsWith('…')).toBe(true);
    });
  });

  describe('useHasContent', () => {
    it('flags presence of all sections when filled', () => {
      const formData: FormData = {
        ...defaultFormData,
        object_id: 'obj-1',
        right_type: 'copyright',
        rights_holder_contact_id: 'contact-1',
        start_date: '2026-01-01',
        license_type: 'exclusive',
        fee_required: true,
        is_orphan_work: true,
        right_note: 'a note',
      };
      const { result } = renderHook(() => useHasContent(formData));
      expect(result.current.object).toBe(true);
      expect(result.current.details).toBe(true);
      expect(result.current.holder).toBe(true);
      expect(result.current.duration).toBe(true);
      expect(result.current.license).toBe(true);
      expect(result.current.fees).toBe(true);
      expect(result.current.orphan).toBe(true);
      expect(result.current.notes).toBe(true);
      expect(result.current.history).toBe(false);
    });

    it('returns false for empty form', () => {
      const formData: FormData = {
        ...defaultFormData,
        right_type: '',
        status: '',
      };
      const { result } = renderHook(() => useHasContent(formData));
      expect(result.current.object).toBe(false);
      expect(result.current.holder).toBe(false);
      expect(result.current.fees).toBe(false);
    });
  });
});
