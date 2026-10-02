import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act, renderHook } from '@testing-library/react';
import {
  WorkProvider,
  useWork,
  filterRecentItemsByApp,
  formatTaskLabel,
  QUICK_ACTIONS,
  type ActiveObject,
  type RecentItem,
} from '../../contexts/WorkContext';

const ACTIVE_KEY = 'madrona.work.activeObject';
const RECENT_KEY = 'madrona.work.recentItems';

function wrapper({ children }: { children: React.ReactNode }) {
  return <WorkProvider>{children}</WorkProvider>;
}

const sampleObject: ActiveObject = {
  object_id: 'obj-1',
  accession_number: '2024.001',
  title: 'Sample Vase',
};

describe('WorkContext', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('WorkProvider', () => {
    it('renders children', () => {
      render(
        <WorkProvider>
          <div data-testid="child">child</div>
        </WorkProvider>
      );
      expect(screen.getByTestId('child')).toHaveTextContent('child');
    });

    it('initializes with no active object and empty recent items', () => {
      const { result } = renderHook(() => useWork(), { wrapper });
      expect(result.current.activeObject).toBeNull();
      expect(result.current.hasObjectContext).toBe(false);
      expect(result.current.recentItems).toEqual([]);
    });

    it('hydrates active object from localStorage', () => {
      localStorage.setItem(ACTIVE_KEY, JSON.stringify(sampleObject));
      const { result } = renderHook(() => useWork(), { wrapper });
      expect(result.current.activeObject).toEqual(sampleObject);
      expect(result.current.hasObjectContext).toBe(true);
    });

    it('handles malformed localStorage gracefully', () => {
      localStorage.setItem(ACTIVE_KEY, 'not-json');
      localStorage.setItem(RECENT_KEY, '{{');
      const { result } = renderHook(() => useWork(), { wrapper });
      expect(result.current.activeObject).toBeNull();
      expect(result.current.recentItems).toEqual([]);
    });
  });

  describe('setActiveObject', () => {
    it('sets the active object', () => {
      const { result } = renderHook(() => useWork(), { wrapper });
      act(() => {
        result.current.setActiveObject(sampleObject);
      });
      expect(result.current.activeObject).toEqual(sampleObject);
      expect(result.current.hasObjectContext).toBe(true);
    });

    it('persists active object to localStorage', () => {
      const { result } = renderHook(() => useWork(), { wrapper });
      act(() => {
        result.current.setActiveObject(sampleObject);
      });
      const stored = JSON.parse(localStorage.getItem(ACTIVE_KEY) || 'null');
      expect(stored).toEqual(sampleObject);
    });

    it('does not add to recent items (route tracker is the single source)', () => {
      const { result } = renderHook(() => useWork(), { wrapper });
      act(() => {
        result.current.setActiveObject(sampleObject);
      });
      expect(result.current.recentItems).toEqual([]);
    });

    it('removes the active object when set to null', () => {
      const { result } = renderHook(() => useWork(), { wrapper });
      act(() => {
        result.current.setActiveObject(sampleObject);
      });
      act(() => {
        result.current.setActiveObject(null);
      });
      expect(result.current.activeObject).toBeNull();
      expect(localStorage.getItem(ACTIVE_KEY)).toBeNull();
    });
  });

  describe('clearActiveObject', () => {
    it('clears the active object', () => {
      const { result } = renderHook(() => useWork(), { wrapper });
      act(() => {
        result.current.setActiveObject(sampleObject);
      });
      act(() => {
        result.current.clearActiveObject();
      });
      expect(result.current.activeObject).toBeNull();
      expect(result.current.hasObjectContext).toBe(false);
    });
  });

  describe('addRecentItem', () => {
    it('adds an item with timestamp', () => {
      const { result } = renderHook(() => useWork(), { wrapper });
      act(() => {
        result.current.addRecentItem({
          id: 'cr-1',
          type: 'condition_report',
          label: 'CR-001',
          path: '/cr/1',
        });
      });
      expect(result.current.recentItems).toHaveLength(1);
      expect(result.current.recentItems[0].id).toBe('cr-1');
      expect(typeof result.current.recentItems[0].timestamp).toBe('number');
    });

    it('moves duplicate to top instead of duplicating', () => {
      const { result } = renderHook(() => useWork(), { wrapper });
      act(() => {
        result.current.addRecentItem({
          id: 'a',
          type: 'condition_report',
          label: 'A',
          path: '/a',
        });
      });
      act(() => {
        result.current.addRecentItem({
          id: 'b',
          type: 'condition_report',
          label: 'B',
          path: '/b',
        });
      });
      // Re-add 'a' — should bump it to top, not duplicate
      act(() => {
        result.current.addRecentItem({
          id: 'a',
          type: 'condition_report',
          label: 'A2',
          path: '/a2',
        });
      });
      expect(result.current.recentItems).toHaveLength(2);
      expect(result.current.recentItems[0].id).toBe('a');
      expect(result.current.recentItems[0].label).toBe('A2');
    });

    it('skips re-add when already most recent (same reference)', () => {
      const { result } = renderHook(() => useWork(), { wrapper });
      act(() => {
        result.current.addRecentItem({
          id: 'x',
          type: 'object',
          label: 'X',
          path: '/x',
        });
      });
      const before = result.current.recentItems;
      act(() => {
        result.current.addRecentItem({
          id: 'x',
          type: 'object',
          label: 'X-new',
          path: '/x',
        });
      });
      // Should be same reference (no-op)
      expect(result.current.recentItems).toBe(before);
    });

    it('caps recent items at 20', () => {
      const { result } = renderHook(() => useWork(), { wrapper });
      act(() => {
        for (let i = 0; i < 25; i++) {
          result.current.addRecentItem({
            id: `item-${i}`,
            type: 'condition_report',
            label: `Item ${i}`,
            path: `/i/${i}`,
          });
        }
      });
      expect(result.current.recentItems).toHaveLength(20);
      // Most recent first
      expect(result.current.recentItems[0].id).toBe('item-24');
    });
  });

  describe('removeRecentItem', () => {
    it('removes a matching item', () => {
      const { result } = renderHook(() => useWork(), { wrapper });
      act(() => {
        result.current.addRecentItem({ id: 'a', type: 'object', label: 'A', path: '/a' });
        result.current.addRecentItem({ id: 'b', type: 'object', label: 'B', path: '/b' });
      });
      act(() => {
        result.current.removeRecentItem('a', 'object');
      });
      expect(result.current.recentItems.find((i) => i.id === 'a')).toBeUndefined();
      expect(result.current.recentItems.find((i) => i.id === 'b')).toBeDefined();
    });

    it('returns same reference when item not found', () => {
      const { result } = renderHook(() => useWork(), { wrapper });
      act(() => {
        result.current.addRecentItem({ id: 'a', type: 'object', label: 'A', path: '/a' });
      });
      const before = result.current.recentItems;
      act(() => {
        result.current.removeRecentItem('nonexistent', 'object');
      });
      expect(result.current.recentItems).toBe(before);
    });
  });

  describe('clearRecentItems', () => {
    it('empties the list', () => {
      const { result } = renderHook(() => useWork(), { wrapper });
      act(() => {
        result.current.addRecentItem({ id: 'a', type: 'object', label: 'A', path: '/a' });
      });
      act(() => {
        result.current.clearRecentItems();
      });
      expect(result.current.recentItems).toEqual([]);
    });
  });

  describe('getAvailableQuickActions', () => {
    it('returns all actions when context is set', () => {
      const { result } = renderHook(() => useWork(), { wrapper });
      const actions = result.current.getAvailableQuickActions(true);
      expect(actions).toHaveLength(QUICK_ACTIONS.length);
    });

    it('returns only context-free actions when no context', () => {
      const { result } = renderHook(() => useWork(), { wrapper });
      const actions = result.current.getAvailableQuickActions(false);
      expect(actions.every((a) => !a.requiresObjectContext)).toBe(true);
      expect(actions.length).toBeLessThan(QUICK_ACTIONS.length);
    });
  });

  describe('buildActionPath', () => {
    it('substitutes orgId for context-free actions', () => {
      const { result } = renderHook(() => useWork(), { wrapper });
      const action = QUICK_ACTIONS.find((a) => !a.requiresObjectContext)!;
      const path = result.current.buildActionPath(action, 'org-123');
      expect(path).toContain('org-123');
      expect(path).not.toContain('{orgId}');
    });

    it('substitutes orgId and objectId for context-bound actions', () => {
      const { result } = renderHook(() => useWork(), { wrapper });
      act(() => {
        result.current.setActiveObject(sampleObject);
      });
      const action = QUICK_ACTIONS.find((a) => a.requiresObjectContext)!;
      const path = result.current.buildActionPath(action, 'org-123');
      expect(path).toContain('org-123');
      expect(path).toContain('obj-1');
      expect(path).not.toContain('{orgId}');
      expect(path).not.toContain('{objectId}');
    });
  });

  describe('useWork outside provider', () => {
    it('throws error', () => {
      expect(() => renderHook(() => useWork())).toThrow(
        /useWork must be used within a WorkProvider/
      );
    });
  });
});

describe('filterRecentItemsByApp', () => {
  const items: RecentItem[] = [
    {
      id: '1',
      type: 'object',
      label: 'A',
      path: '/organizations/org-1/collections/objects/1',
      timestamp: 1,
    },
    {
      id: '2',
      type: 'media_asset',
      label: 'B',
      path: '/organizations/org-1/media/library/2',
      timestamp: 2,
    },
    {
      id: '3',
      type: 'object',
      label: 'C',
      path: '',
      timestamp: 3,
    },
  ];

  it('returns all items when activeProductId is null', () => {
    expect(filterRecentItemsByApp(items, null)).toEqual(items);
  });

  it('filters items by app segment', () => {
    const out = filterRecentItemsByApp(items, 'collections');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('1');
  });

  it('excludes items with no path when filtering', () => {
    const out = filterRecentItemsByApp(items, 'collections');
    expect(out.find((i) => i.id === '3')).toBeUndefined();
  });

  it('returns empty when no items match the active product', () => {
    expect(filterRecentItemsByApp(items, 'guide')).toEqual([]);
  });
});

describe('formatTaskLabel', () => {
  it('formats label for single object with title', () => {
    const { label, groupLabel } = formatTaskLabel(
      'Review',
      'condition_report',
      '2024.001',
      'Sample Vase',
    );
    expect(label).toContain('Review');
    expect(label).toContain('2024.001');
    expect(label).toContain('Sample Vase');
    expect(groupLabel).toBe('Care & Risk');
  });

  it('truncates long titles', () => {
    const longTitle = 'A'.repeat(50);
    const { label } = formatTaskLabel('Review', 'object', '2024.001', longTitle);
    expect(label).toContain('...');
    // Not the full 50-char title
    expect(label).not.toContain(longTitle);
  });

  it('formats multi-object label with count', () => {
    const { label } = formatTaskLabel(
      'Pack',
      'loan_out',
      '2024.001',
      undefined,
      'LO-2024-1',
      5,
    );
    expect(label).toContain('LO-2024-1');
    expect(label).toContain('5 objects');
    expect(label).toContain('2024.001');
  });

  it('formats label with record number when no object', () => {
    const { label, groupLabel } = formatTaskLabel(
      'Approve',
      'loan_in',
      undefined,
      undefined,
      'LI-2024-1',
    );
    expect(label).toContain('Approve');
    expect(label).toContain('LI-2024-1');
    expect(groupLabel).toBe('Transactions');
  });

  it('uses Unknown group for unknown record type', () => {
    const { groupLabel } = formatTaskLabel('Do', 'unknown_record_type');
    expect(groupLabel).toBe('Unknown');
  });

  it('returns just the task type when nothing else provided', () => {
    const { label } = formatTaskLabel('Solo Task', 'object');
    expect(label).toBe('Solo Task');
  });
});
