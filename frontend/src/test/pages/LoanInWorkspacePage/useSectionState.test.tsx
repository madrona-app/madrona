import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, useQueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSectionState } from '../../../pages/collections/LoanInWorkspacePage/useSectionState';

// Stub useSectionOrder so we don't need a real Provider / auth context
vi.mock('../../../components/record-detail', async () => {
  const actual = await vi.importActual<typeof import('../../../components/record-detail')>(
    '../../../components/record-detail'
  );
  return {
    ...actual,
    useSectionOrder: () => [{}, vi.fn(), vi.fn()] as ReturnType<typeof actual.useSectionOrder>,
  };
});

function createTestEnv() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/organizations/org-1/collections/loans-in/loan-1/edit']}>
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  return { Wrapper, qc };
}

function renderSectionState(args: Partial<Parameters<typeof useSectionState>[0]> = {}) {
  const { Wrapper, qc } = createTestEnv();
  const setIsEditing = vi.fn();
  const performSave = vi.fn();

  // Build a wrapper that consumes queryClient via context
  function Inner({ args }: { args: Parameters<typeof useSectionState>[0] }) {
    const queryClient = useQueryClient();
    return useSectionState({ ...args, queryClient }) as never;
  }

  // Use renderHook to capture return value
  const result = renderHook(
    () => {
      const queryClient = useQueryClient();
      return useSectionState({
        orgId: 'org-1',
        loanId: 'loan-1',
        isCreateMode: false,
        isEditing: true,
        setIsEditing,
        canEdit: true,
        hasUnsavedChanges: false,
        performSave,
        queryClient,
        ...args,
      });
    },
    { wrapper: Wrapper }
  );

  return { ...result, setIsEditing, performSave, qc, _Inner: Inner };
}

describe('useSectionState (LoanIn)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('expandedSections', () => {
    it('initializes with lender and details expanded', () => {
      const { result } = renderSectionState();
      expect(result.current.expandedSections.lender).toBe(true);
      expect(result.current.expandedSections.details).toBe(true);
      expect(result.current.expandedSections.facility).toBe(false);
    });
  });

  describe('toggleSection (in editing mode)', () => {
    it('collapses an open section when already editing', () => {
      const { result } = renderSectionState({ isEditing: true });
      // 'lender' starts expanded
      act(() => {
        result.current.toggleSection('lender');
      });
      expect(result.current.expandedSections.lender).toBe(false);
    });

    it('opens a closed section as the only expanded section (accordion)', () => {
      const { result } = renderSectionState({ isEditing: true });
      act(() => {
        result.current.toggleSection('insurance');
      });
      expect(result.current.expandedSections.insurance).toBe(true);
      expect(result.current.expandedSections.lender).toBe(false);
      expect(result.current.expandedSections.details).toBe(false);
    });
  });

  describe('toggleSection (view mode -> edit mode)', () => {
    it('collapsing an already-open section in view mode triggers edit mode', () => {
      const { result, setIsEditing } = renderSectionState({ isEditing: false, canEdit: true });
      // lender is already expanded; toggling it should *raise* it not collapse it
      act(() => {
        result.current.toggleSection('lender');
      });
      expect(result.current.expandedSections.lender).toBe(true);
      expect(setIsEditing).toHaveBeenCalledWith(true);
    });

    it('opening a closed section in view mode triggers edit mode and accordion-collapses others', () => {
      const { result, setIsEditing } = renderSectionState({ isEditing: false, canEdit: true });
      act(() => {
        result.current.toggleSection('agreement');
      });
      expect(result.current.expandedSections.agreement).toBe(true);
      expect(result.current.expandedSections.lender).toBe(false);
      expect(setIsEditing).toHaveBeenCalledWith(true);
    });

    it('does NOT enter edit mode when canEdit is false', () => {
      const { result, setIsEditing } = renderSectionState({ isEditing: false, canEdit: false });
      act(() => {
        result.current.toggleSection('agreement');
      });
      expect(setIsEditing).not.toHaveBeenCalledWith(true);
    });
  });

  describe('handleEnterEditMode', () => {
    it('expands only the requested section', () => {
      const { result } = renderSectionState({ isEditing: true });
      act(() => {
        result.current.handleEnterEditMode('insurance');
      });
      expect(result.current.expandedSections.insurance).toBe(true);
      expect(result.current.expandedSections.lender).toBe(false);
      expect(result.current.expandedSections.details).toBe(false);
    });
  });

  describe('handleToggleMode', () => {
    it('flips edit mode and saves pending changes when exiting', () => {
      const { result, setIsEditing, performSave } = renderSectionState({
        isEditing: true,
        hasUnsavedChanges: true,
      });
      act(() => {
        result.current.handleToggleMode();
      });
      // setIsEditing called with false (toggle from true)
      expect(setIsEditing).toHaveBeenCalledWith(false);
      // and pending changes are saved
      expect(performSave).toHaveBeenCalled();
    });

    it('does not save when there are no pending changes', () => {
      const { result, performSave } = renderSectionState({
        isEditing: true,
        hasUnsavedChanges: false,
      });
      act(() => {
        result.current.handleToggleMode();
      });
      expect(performSave).not.toHaveBeenCalled();
    });

    it('does not save in create mode even with pending changes', () => {
      const { result, performSave } = renderSectionState({
        isEditing: true,
        isCreateMode: true,
        hasUnsavedChanges: true,
      });
      act(() => {
        result.current.handleToggleMode();
      });
      expect(performSave).not.toHaveBeenCalled();
    });
  });

  describe('getSectionOrder', () => {
    it('returns undefined when no custom order is set for the group', () => {
      const { result } = renderSectionState();
      // With our mocked sectionOrder = {}, no override -> undefined
      expect(result.current.getSectionOrder('lender')).toBeUndefined();
    });

    it('returns undefined for unknown section ids', () => {
      const { result } = renderSectionState();
      expect(result.current.getSectionOrder('not-a-section')).toBeUndefined();
    });
  });
});
