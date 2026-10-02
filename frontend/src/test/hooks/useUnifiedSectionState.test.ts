import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUnifiedSectionState } from '../../hooks/useUnifiedSectionState';
import type { UseUnifiedSectionStateOptions } from '../../hooks/useUnifiedSectionState';

// Mock useSectionOrder
vi.mock('../../components/record-detail', () => ({
  useSectionOrder: vi.fn(() => [{}, vi.fn()]),
}));

// DOM element mock helper
function createMockElement() {
  return {
    classList: {
      remove: vi.fn(),
      add: vi.fn(),
    },
    scrollIntoView: vi.fn(),
  };
}

describe('useUnifiedSectionState', () => {
  const defaultSectionGroups: Record<string, string> = {
    info: 'overview',
    contacts: 'overview',
    objects: 'details',
    notes: 'details',
    outcome: 'outcome',
  };

  const defaultGroupOrder = ['overview', 'details', 'outcome'];

  const defaultInitialExpanded: Record<string, boolean> = {
    info: true,
    contacts: false,
    objects: false,
    notes: false,
    outcome: false,
  };

  const defaultOptions: UseUnifiedSectionStateOptions = {
    sectionGroups: defaultSectionGroups,
    groupOrder: defaultGroupOrder,
    initialExpandedSections: defaultInitialExpanded,
  };

  let replaceStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, 'getElementById').mockReturnValue(null);
    replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // 1. Initializes expandedSections from initialExpandedSections
  it('initializes expandedSections from initialExpandedSections', () => {
    const { result } = renderHook(() => useUnifiedSectionState(defaultOptions));

    expect(result.current.expandedSections).toEqual({
      info: true,
      contacts: false,
      objects: false,
      notes: false,
      outcome: false,
    });
  });

  // 2. toggleSection expands a collapsed section and collapses others (accordion)
  it('toggleSection expands a collapsed section and collapses others', () => {
    const { result } = renderHook(() => useUnifiedSectionState(defaultOptions));

    // Initially info is expanded, objects is collapsed
    expect(result.current.expandedSections.info).toBe(true);
    expect(result.current.expandedSections.objects).toBe(false);

    act(() => {
      result.current.toggleSection('objects');
    });

    // objects should now be the only expanded section
    expect(result.current.expandedSections.objects).toBe(true);
    expect(result.current.expandedSections.info).toBe(false);
    expect(result.current.expandedSections.contacts).toBe(false);
    expect(result.current.expandedSections.notes).toBe(false);
  });

  // 3. toggleSection on already-expanded section collapses it (when in edit mode)
  it('toggleSection on already-expanded section collapses it when already editing', () => {
    const setIsEditing = vi.fn();
    const options: UseUnifiedSectionStateOptions = {
      ...defaultOptions,
      editMode: {
        basePath: '/org/1/loans/2',
        isEditing: true,
        setIsEditing,
        canEdit: true,
        isCreateMode: false,
      },
    };

    const { result } = renderHook(() => useUnifiedSectionState(options));

    // info starts expanded
    expect(result.current.expandedSections.info).toBe(true);

    act(() => {
      result.current.toggleSection('info');
    });

    // Should collapse since we are already in edit mode
    expect(result.current.expandedSections.info).toBe(false);
  });

  // 4. toggleSection enters edit mode when clicking expanded section while not editing
  it('toggleSection enters edit mode when clicking expanded section while not editing', () => {
    const setIsEditing = vi.fn();
    const options: UseUnifiedSectionStateOptions = {
      ...defaultOptions,
      editMode: {
        basePath: '/org/1/loans/2',
        isEditing: false,
        setIsEditing,
        canEdit: true,
        isCreateMode: false,
      },
    };

    const { result } = renderHook(() => useUnifiedSectionState(options));

    // info starts expanded — clicking it while not editing should enter edit mode
    expect(result.current.expandedSections.info).toBe(true);

    act(() => {
      result.current.toggleSection('info');
    });

    // Should have called setIsEditing(true) via raiseSection
    expect(setIsEditing).toHaveBeenCalledWith(true);
    // info should remain the only expanded section
    expect(result.current.expandedSections.info).toBe(true);
    // URL should be updated
    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/org/1/loans/2/edit');
  });

  // 5. getSectionOrder returns correct CSS order value based on group/section position
  it('getSectionOrder returns correct CSS order value with custom section order', async () => {
    const { useSectionOrder } = await import('../../components/record-detail');
    const mockUseSectionOrder = vi.mocked(useSectionOrder);

    // Simulate custom order where overview group has ['contacts', 'info']
    mockUseSectionOrder.mockReturnValue([
      {
        overview: ['contacts', 'info'],
        details: ['notes', 'objects'],
      },
      vi.fn(),
    ]);

    const { result } = renderHook(() => useUnifiedSectionState(defaultOptions));

    // overview is groupIndex 0, contacts is at index 0 within group => 0*100 + 0 = 0
    expect(result.current.getSectionOrder('contacts')).toBe(0);
    // overview group, info is at index 1 => 0*100 + 1 = 1
    expect(result.current.getSectionOrder('info')).toBe(1);
    // details is groupIndex 1, notes is at index 0 => 1*100 + 0 = 100
    expect(result.current.getSectionOrder('notes')).toBe(100);
    // details group, objects is at index 1 => 1*100 + 1 = 101
    expect(result.current.getSectionOrder('objects')).toBe(101);

    // Reset mock
    mockUseSectionOrder.mockReturnValue([{}, vi.fn()]);
  });

  // 6. getSectionOrder returns undefined for unknown sections
  it('getSectionOrder returns undefined for unknown sections', () => {
    const { result } = renderHook(() => useUnifiedSectionState(defaultOptions));

    expect(result.current.getSectionOrder('nonexistent')).toBeUndefined();
  });

  // 7. handleEnterEditMode expands target section and collapses others
  it('handleEnterEditMode expands target section and collapses others', () => {
    const { result } = renderHook(() => useUnifiedSectionState(defaultOptions));

    expect(result.current.expandedSections.info).toBe(true);
    expect(result.current.expandedSections.objects).toBe(false);

    act(() => {
      result.current.handleEnterEditMode('objects');
    });

    // Only objects should be expanded
    expect(result.current.expandedSections.objects).toBe(true);
    expect(result.current.expandedSections.info).toBe(false);
    expect(result.current.expandedSections.contacts).toBe(false);
    // raisedSectionId should be set
    expect(result.current.raisedSectionId).toBe('objects');
  });

  // 8. handleToggleMode toggles isEditing and updates URL
  it('handleToggleMode toggles isEditing and updates URL', () => {
    const setIsEditing = vi.fn();
    const options: UseUnifiedSectionStateOptions = {
      ...defaultOptions,
      editMode: {
        basePath: '/org/1/loans/2',
        isEditing: false,
        setIsEditing,
        canEdit: true,
        isCreateMode: false,
      },
    };

    const { result } = renderHook(() => useUnifiedSectionState(options));

    expect(result.current.handleToggleMode).toBeDefined();

    act(() => {
      result.current.handleToggleMode!();
    });

    // Should toggle to editing
    expect(setIsEditing).toHaveBeenCalledWith(true);
    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/org/1/loans/2/edit');
  });

  // 9. handleToggleMode calls onExitEditMode when switching to view mode
  it('handleToggleMode calls onExitEditMode when switching to view mode', () => {
    const setIsEditing = vi.fn();
    const onExitEditMode = vi.fn();
    const options: UseUnifiedSectionStateOptions = {
      ...defaultOptions,
      editMode: {
        basePath: '/org/1/loans/2',
        isEditing: true,
        setIsEditing,
        canEdit: true,
        isCreateMode: false,
        onExitEditMode,
      },
    };

    const { result } = renderHook(() => useUnifiedSectionState(options));

    act(() => {
      result.current.handleToggleMode!();
    });

    // Should toggle to not editing
    expect(setIsEditing).toHaveBeenCalledWith(false);
    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/org/1/loans/2');
    expect(onExitEditMode).toHaveBeenCalled();
  });

  // 10. handleToggleMode calls onSaveBeforeExit when there are unsaved changes
  it('handleToggleMode calls onSaveBeforeExit when there are unsaved changes', () => {
    const setIsEditing = vi.fn();
    const onSaveBeforeExit = vi.fn();
    const onExitEditMode = vi.fn();
    const options: UseUnifiedSectionStateOptions = {
      ...defaultOptions,
      editMode: {
        basePath: '/org/1/loans/2',
        isEditing: true,
        setIsEditing,
        canEdit: true,
        isCreateMode: false,
        hasUnsavedChanges: true,
        onSaveBeforeExit,
        onExitEditMode,
      },
    };

    const { result } = renderHook(() => useUnifiedSectionState(options));

    act(() => {
      result.current.handleToggleMode!();
    });

    expect(onSaveBeforeExit).toHaveBeenCalled();
    expect(onExitEditMode).toHaveBeenCalled();
  });

  // 11. lowerAllSections clears raisedSectionId
  it('lowerAllSections clears raisedSectionId', () => {
    const mockElement = createMockElement();
    vi.spyOn(document, 'getElementById').mockImplementation((id: string) => {
      if (id === 'section-objects' || id === 'objects') {
        return mockElement as unknown as HTMLElement;
      }
      return null;
    });

    const { result } = renderHook(() => useUnifiedSectionState(defaultOptions));

    // First raise a section
    act(() => {
      result.current.handleEnterEditMode('objects');
    });
    expect(result.current.raisedSectionId).toBe('objects');

    // Now lower all
    act(() => {
      result.current.lowerAllSections();
    });
    expect(result.current.raisedSectionId).toBeNull();
    expect(mockElement.classList.remove).toHaveBeenCalledWith('section-raised', 'section-raise-enter');
    expect(mockElement.classList.add).toHaveBeenCalledWith('section-raise-exit');
  });

  // 12. Smart expand: auto-expands sections with data on initial load
  it('auto-expands sections with data via smartExpand', () => {
    const sectionGroupDefs = [
      {
        id: 'overview',
        label: 'Overview',
        sections: [
          { id: 'info', label: 'Info', dataKey: 'title' },
          { id: 'contacts', label: 'Contacts', dataKey: 'contact_name' },
        ],
      },
      {
        id: 'details',
        label: 'Details',
        sections: [
          { id: 'objects', label: 'Objects', dataKey: 'objects_list' },
          { id: 'notes', label: 'Notes', dataKey: 'notes_text' },
        ],
      },
    ];

    const data: Record<string, unknown> = {
      title: 'Test Loan',
      contact_name: '',        // empty — should not expand
      objects_list: [1, 2, 3], // has data — should expand
      notes_text: null,        // null — should not expand
    };

    const options: UseUnifiedSectionStateOptions = {
      ...defaultOptions,
      smartExpand: { data, sectionGroupDefs },
    };

    const { result } = renderHook(() => useUnifiedSectionState(options));

    // info should be expanded (has data via 'title')
    expect(result.current.expandedSections.info).toBe(true);
    // contacts should NOT be expanded (empty string)
    expect(result.current.expandedSections.contacts).toBe(false);
    // objects should be expanded (non-empty array)
    expect(result.current.expandedSections.objects).toBe(true);
    // notes should NOT be expanded (null)
    expect(result.current.expandedSections.notes).toBe(false);
  });

  it('smartExpand does not expand sections with empty arrays', () => {
    const sectionGroupDefs = [
      {
        id: 'details',
        label: 'Details',
        sections: [
          { id: 'objects', label: 'Objects', dataKey: 'items' },
        ],
      },
    ];

    const options: UseUnifiedSectionStateOptions = {
      ...defaultOptions,
      smartExpand: {
        data: { items: [] },
        sectionGroupDefs,
      },
    };

    const { result } = renderHook(() => useUnifiedSectionState(options));

    expect(result.current.expandedSections.objects).toBe(false);
  });

  // 13. Works without editMode (always-edit pages like ObjectEntry)
  it('works without editMode — handleToggleMode is undefined', () => {
    const { result } = renderHook(() => useUnifiedSectionState(defaultOptions));

    expect(result.current.handleToggleMode).toBeUndefined();
  });

  it('toggleSection works without editMode (always collapses on re-click)', () => {
    const { result } = renderHook(() => useUnifiedSectionState(defaultOptions));

    // info starts expanded
    expect(result.current.expandedSections.info).toBe(true);

    // Toggle info — should collapse it (no edit mode gate)
    act(() => {
      result.current.toggleSection('info');
    });

    // Without editMode and section already expanded, it collapses
    expect(result.current.expandedSections.info).toBe(false);
  });

  it('handleEnterEditMode sets raisedSectionId without editMode', () => {
    const { result } = renderHook(() => useUnifiedSectionState(defaultOptions));

    act(() => {
      result.current.handleEnterEditMode('notes');
    });

    expect(result.current.raisedSectionId).toBe('notes');
    expect(result.current.expandedSections.notes).toBe(true);
    // All others collapsed
    expect(result.current.expandedSections.info).toBe(false);
  });

  it('handleToggleMode does not call onSaveBeforeExit in create mode', () => {
    const setIsEditing = vi.fn();
    const onSaveBeforeExit = vi.fn();
    const options: UseUnifiedSectionStateOptions = {
      ...defaultOptions,
      editMode: {
        basePath: '/org/1/loans/new',
        isEditing: true,
        setIsEditing,
        canEdit: true,
        isCreateMode: true,
        hasUnsavedChanges: true,
        onSaveBeforeExit,
      },
    };

    const { result } = renderHook(() => useUnifiedSectionState(options));

    act(() => {
      result.current.handleToggleMode!();
    });

    // In create mode, onSaveBeforeExit should NOT be called
    expect(onSaveBeforeExit).not.toHaveBeenCalled();
    // URL should NOT be updated in create mode
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it('raiseSection applies DOM classes and scrolls into view', () => {
    const mockElement = createMockElement();
    vi.spyOn(document, 'getElementById').mockImplementation((id: string) => {
      if (id === 'section-notes') {
        return mockElement as unknown as HTMLElement;
      }
      return null;
    });

    const { result } = renderHook(() => useUnifiedSectionState(defaultOptions));

    act(() => {
      result.current.handleEnterEditMode('notes');
    });

    // The raise animation is delayed by 50ms
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(mockElement.classList.add).toHaveBeenCalledWith('section-raise-enter', 'section-raised');
    expect(mockElement.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
  });
});
