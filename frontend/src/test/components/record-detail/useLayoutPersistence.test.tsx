import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, render } from '@testing-library/react';
import type { ReactNode } from 'react';

// Mock useAuth so these hooks can run without an AuthProvider
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { user_id: 'user-1' },
    activeOrganizationId: 'org-1',
  }),
}));

import {
  useAccordionState,
  useRecentSections,
  useSectionNavCollapsed,
  useRightRailCollapsed,
  useRecentSectionsCollapsed,
  useNavGroupsExpanded,
  useSectionOrder,
  SectionOrderProvider,
  STORAGE_KEYS,
} from '../../../components/record-detail/useLayoutPersistence';

beforeEach(() => {
  localStorage.clear();
});

describe('STORAGE_KEYS', () => {
  it('generates versioned, scoped keys', () => {
    expect(STORAGE_KEYS.accordionState('o', 'u')).toBe(
      'madrona:v1:org:o:user:u:record:accordions',
    );
    expect(STORAGE_KEYS.recentSections('o', 'u')).toBe(
      'madrona:v1:org:o:user:u:record:recentSections',
    );
    expect(STORAGE_KEYS.sectionNavCollapsed('u')).toBe(
      'madrona:v1:user:u:ui:sectionNavCollapsed',
    );
    expect(STORAGE_KEYS.rightRailCollapsed('u')).toBe(
      'madrona:v1:user:u:ui:rightRailCollapsed',
    );
    expect(STORAGE_KEYS.navGroupsExpanded('u', 'object-entry')).toBe(
      'madrona:v1:user:u:ui:navGroups:object-entry',
    );
  });
});

describe('useAccordionState', () => {
  it('starts with default expanded sections', () => {
    const { result } = renderHook(() => useAccordionState());
    const [expanded] = result.current;
    expect(expanded.has('identification')).toBe(true);
    expect(expanded.has('physical')).toBe(true);
    expect(expanded.size).toBe(2);
  });

  it('toggleSection adds and removes a section id', () => {
    const { result } = renderHook(() => useAccordionState());

    act(() => {
      result.current[1]('condition');
    });
    expect(result.current[0].has('condition')).toBe(true);

    act(() => {
      result.current[1]('condition');
    });
    expect(result.current[0].has('condition')).toBe(false);
  });

  it('persists state to localStorage on toggle', () => {
    const { result } = renderHook(() => useAccordionState());
    act(() => {
      result.current[1]('new-section');
    });
    const stored = localStorage.getItem(STORAGE_KEYS.accordionState('org-1', 'user-1'));
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.expandedSections).toContain('new-section');
    expect(typeof parsed.updatedAt).toBe('string');
  });

  it('resetToDefault restores default sections', () => {
    const { result } = renderHook(() => useAccordionState());
    act(() => {
      result.current[1]('identification'); // remove default
      result.current[1]('extra');
    });
    expect(result.current[0].has('identification')).toBe(false);

    act(() => {
      result.current[2]();
    });
    expect(result.current[0].has('identification')).toBe(true);
    expect(result.current[0].has('physical')).toBe(true);
    expect(result.current[0].has('extra')).toBe(false);
  });

  it('loads persisted state on mount', () => {
    localStorage.setItem(
      STORAGE_KEYS.accordionState('org-1', 'user-1'),
      JSON.stringify({ expandedSections: ['foo', 'bar'], updatedAt: '2026-01-01' }),
    );
    const { result } = renderHook(() => useAccordionState());
    expect(result.current[0].has('foo')).toBe(true);
    expect(result.current[0].has('bar')).toBe(true);
    expect(result.current[0].has('identification')).toBe(false);
  });
});

describe('useRecentSections', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useRecentSections());
    expect(result.current[0]).toEqual([]);
  });

  it('recordVisit prepends new items and deduplicates', () => {
    const { result } = renderHook(() => useRecentSections());
    act(() => {
      result.current[1]('a');
    });
    act(() => {
      result.current[1]('b');
    });
    act(() => {
      result.current[1]('c');
    });
    expect(result.current[0]).toEqual(['c', 'b', 'a']);

    // Revisiting 'a' moves it to the front
    act(() => {
      result.current[1]('a');
    });
    expect(result.current[0]).toEqual(['a', 'c', 'b']);
  });

  it('caps to MAX_RECENT_SECTIONS (3)', () => {
    const { result } = renderHook(() => useRecentSections());
    act(() => {
      result.current[1]('a');
      result.current[1]('b');
      result.current[1]('c');
      result.current[1]('d');
    });
    expect(result.current[0].length).toBe(3);
    expect(result.current[0][0]).toBe('d');
    expect(result.current[0]).not.toContain('a');
  });
});

describe('useSectionNavCollapsed / useRightRailCollapsed', () => {
  it('sectionNavCollapsed defaults to false', () => {
    const { result } = renderHook(() => useSectionNavCollapsed());
    expect(result.current[0]).toBe(false);
  });

  it('sectionNavCollapsed setter updates state and persists', () => {
    const { result } = renderHook(() => useSectionNavCollapsed());
    act(() => {
      result.current[1](true);
    });
    expect(result.current[0]).toBe(true);
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEYS.sectionNavCollapsed('user-1'))!),
    ).toBe(true);
  });

  it('rightRailCollapsed defaults to false and persists on change', () => {
    const { result } = renderHook(() => useRightRailCollapsed());
    expect(result.current[0]).toBe(false);
    act(() => {
      result.current[1](true);
    });
    expect(result.current[0]).toBe(true);
  });

  it('recentSectionsCollapsed defaults to true (collapsed for new users)', () => {
    const { result } = renderHook(() => useRecentSectionsCollapsed());
    expect(result.current[0]).toBe(true);
  });
});

describe('useNavGroupsExpanded', () => {
  it('starts with the provided default expanded group ids', () => {
    const { result } = renderHook(() => useNavGroupsExpanded('object', ['work', 'core']));
    expect(result.current[0].has('work')).toBe(true);
    expect(result.current[0].has('core')).toBe(true);
    expect(result.current[0].size).toBe(2);
  });

  it('toggleGroup adds and removes a group id', () => {
    const { result } = renderHook(() => useNavGroupsExpanded('object', ['work']));
    act(() => {
      result.current[1]('core');
    });
    expect(result.current[0].has('core')).toBe(true);
    act(() => {
      result.current[1]('work');
    });
    expect(result.current[0].has('work')).toBe(false);
  });

  it('scopes persistence by pageType', () => {
    const { result: a } = renderHook(() => useNavGroupsExpanded('page-a', ['g1']));
    const { result: b } = renderHook(() => useNavGroupsExpanded('page-b', ['g2']));
    act(() => {
      a.current[1]('g-added');
    });
    expect(a.current[0].has('g-added')).toBe(true);
    expect(b.current[0].has('g-added')).toBe(false);
  });
});

describe('useSectionOrder', () => {
  function wrapper({ children }: { children: ReactNode }) {
    return <SectionOrderProvider>{children}</SectionOrderProvider>;
  }

  it('starts with an empty order map', () => {
    const { result } = renderHook(() => useSectionOrder(), { wrapper });
    expect(result.current[0]).toEqual({});
  });

  it('updateGroupOrder sets a group order and resetOrder clears it', () => {
    const { result } = renderHook(() => useSectionOrder(), { wrapper });

    act(() => {
      result.current[1]('work', ['a', 'b', 'c']);
    });
    expect(result.current[0].work).toEqual(['a', 'b', 'c']);

    act(() => {
      result.current[1]('core', ['x']);
    });
    expect(result.current[0].core).toEqual(['x']);
    expect(result.current[0].work).toEqual(['a', 'b', 'c']);

    act(() => {
      result.current[2]();
    });
    expect(result.current[0]).toEqual({});
  });

  it('falls back to standalone mode when no provider is present', () => {
    const { result } = renderHook(() => useSectionOrder());
    expect(result.current[0]).toEqual({});
    act(() => {
      result.current[1]('group-x', ['one']);
    });
    expect(result.current[0]['group-x']).toEqual(['one']);
  });

  it('provider wiring does not crash when rendered', () => {
    expect(() =>
      render(
        <SectionOrderProvider>
          <div>child</div>
        </SectionOrderProvider>,
      ),
    ).not.toThrow();
  });
});
