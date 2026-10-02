import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ChecklistProgressHeader,
  calculatePhaseProgress,
  groupItemsByPhase,
} from '../../../components/exhibit/ExhibitionChecklistTab/ChecklistProgress';
import type { ChecklistItem } from '../../../components/exhibit/ExhibitionChecklistTab/types';

function makeItem(
  overrides: Partial<ChecklistItem> = {},
): ChecklistItem {
  return {
    item_id: 'i-1',
    phase: 'planning',
    title: 'Draft checklist item',
    description: null,
    responsible_role: 'curator',
    assigned_user_id: null,
    assigned_user_name: null,
    due_date: null,
    status: 'todo',
    notes: null,
    sort_order: 0,
    links_count: 0,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    completed_at: null,
    completed_by: null,
    ...overrides,
  };
}

describe('ChecklistProgressHeader', () => {
  it('renders the checklist name', () => {
    render(
      <ChecklistProgressHeader
        checklistName="Opening Night"
        items={[]}
        allExpanded={false}
        onToggleAll={vi.fn()}
      />,
    );
    expect(screen.getByText('Opening Night')).toBeInTheDocument();
  });

  it('shows "Expand All" when not all expanded, toggles via button', () => {
    const onToggleAll = vi.fn();
    render(
      <ChecklistProgressHeader
        checklistName="List"
        items={[]}
        allExpanded={false}
        onToggleAll={onToggleAll}
      />,
    );
    const button = screen.getByRole('button', { name: 'Expand All' });
    fireEvent.click(button);
    expect(onToggleAll).toHaveBeenCalledTimes(1);
  });

  it('shows "Collapse All" when all expanded', () => {
    render(
      <ChecklistProgressHeader
        checklistName="List"
        items={[]}
        allExpanded
        onToggleAll={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Collapse All' }),
    ).toBeInTheDocument();
  });

  it('shows completion label from items', () => {
    const items = [
      makeItem({ item_id: 'a', status: 'done' }),
      makeItem({ item_id: 'b', status: 'not_applicable' }),
      makeItem({ item_id: 'c', status: 'in_progress' }),
      makeItem({ item_id: 'd', status: 'todo' }),
    ];
    render(
      <ChecklistProgressHeader
        checklistName="List"
        items={items}
        allExpanded={false}
        onToggleAll={vi.fn()}
      />,
    );
    expect(screen.getByText('2 of 4 complete')).toBeInTheDocument();
  });
});

describe('calculatePhaseProgress', () => {
  it('returns zeroes when no items for that phase', () => {
    expect(
      calculatePhaseProgress([makeItem({ phase: 'install' })], 'planning'),
    ).toEqual({ done: 0, total: 0, percent: 0 });
  });

  it('counts done and not_applicable as complete', () => {
    const items = [
      makeItem({ item_id: 'a', phase: 'install', status: 'done' }),
      makeItem({ item_id: 'b', phase: 'install', status: 'not_applicable' }),
      makeItem({ item_id: 'c', phase: 'install', status: 'todo' }),
    ];
    const { done, total, percent } = calculatePhaseProgress(items, 'install');
    expect(done).toBe(2);
    expect(total).toBe(3);
    expect(percent).toBe(67);
  });

  it('ignores items in other phases', () => {
    const items = [
      makeItem({ item_id: 'a', phase: 'install', status: 'done' }),
      makeItem({ item_id: 'b', phase: 'planning', status: 'done' }),
    ];
    expect(calculatePhaseProgress(items, 'install')).toEqual({
      done: 1,
      total: 1,
      percent: 100,
    });
  });
});

describe('groupItemsByPhase', () => {
  it('groups all items into their phase buckets', () => {
    const items = [
      makeItem({ item_id: 'a', phase: 'planning' }),
      makeItem({ item_id: 'b', phase: 'install' }),
      makeItem({ item_id: 'c', phase: 'install' }),
    ];
    const grouped = groupItemsByPhase(items);
    expect(grouped.planning).toHaveLength(1);
    expect(grouped.install).toHaveLength(2);
    // Missing phases exist as empty arrays
    expect(grouped.open).toEqual([]);
    expect(grouped.close).toEqual([]);
  });
});
