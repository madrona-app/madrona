import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PhaseGroup } from '../../../components/exhibit/ExhibitionChecklistTab/ChecklistSection';
import type { ChecklistItem } from '../../../components/exhibit/ExhibitionChecklistTab/types';

vi.mock('../../../components/Checkbox', () => ({
  default: ({
    checked,
    onChange,
    'aria-label': ariaLabel,
  }: {
    checked: boolean;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    'aria-label'?: string;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={ariaLabel}
    />
  ),
}));

vi.mock('../../../components/exhibit/ExhibitionChecklistTab/ChecklistItem', () => ({
  ChecklistItemRow: ({ item }: { item: ChecklistItem }) => (
    <tr data-testid={`row-${item.item_id}`}>
      <td>{item.title}</td>
    </tr>
  ),
}));

function makeItem(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    item_id: 'i-1',
    phase: 'planning',
    title: 'Item',
    description: null,
    responsible_role: 'curator',
    assigned_user_id: null,
    due_date: null,
    status: 'todo',
    notes: null,
    sort_order: 0,
    links_count: 0,
    created_at: '',
    updated_at: '',
    completed_at: null,
    completed_by: null,
    ...overrides,
  };
}

function renderGroup(props: Partial<Parameters<typeof PhaseGroup>[0]> = {}) {
  const defaults = {
    phase: 'planning' as const,
    items: [makeItem({ item_id: 'a', title: 'Alpha' }), makeItem({ item_id: 'b', title: 'Beta' })],
    isExpanded: true,
    onToggle: vi.fn(),
    onStatusChange: vi.fn(),
    onItemClick: vi.fn(),
    selectedItems: new Set<string>(),
    onToggleSelect: vi.fn(),
    canEdit: true,
  };
  return { ...defaults, ...props, ...render(<PhaseGroup {...defaults} {...props} />) };
}

describe('PhaseGroup', () => {
  it('renders the phase label', () => {
    renderGroup();
    expect(screen.getByText('Planning')).toBeInTheDocument();
  });

  it('shows progress count', () => {
    renderGroup({ items: [makeItem({ item_id: 'a', status: 'done' }), makeItem({ item_id: 'b' })] });
    expect(screen.getByText('1 of 2 complete')).toBeInTheDocument();
  });

  it('shows 100% when all items are done', () => {
    renderGroup({ items: [makeItem({ status: 'done' }), makeItem({ item_id: 'x', status: 'done' })] });
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('counts not_applicable as completed', () => {
    renderGroup({ items: [makeItem({ status: 'not_applicable' })] });
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('shows 0% when nothing is done', () => {
    renderGroup({
      items: [makeItem({ status: 'todo' }), makeItem({ item_id: 'x', status: 'in_progress' })],
    });
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('renders one row per item when expanded', () => {
    renderGroup();
    expect(screen.getByTestId('row-a')).toBeInTheDocument();
    expect(screen.getByTestId('row-b')).toBeInTheDocument();
  });

  it('hides rows when collapsed', () => {
    renderGroup({ isExpanded: false });
    expect(screen.queryByTestId('row-a')).toBeNull();
  });

  it('clicking the header toggles expansion', () => {
    const onToggle = vi.fn();
    renderGroup({ onToggle });
    fireEvent.click(screen.getByText('Planning'));
    expect(onToggle).toHaveBeenCalled();
  });

  it('shows empty state when expanded with no items', () => {
    renderGroup({ items: [], isExpanded: true });
    expect(screen.getByText('No items in this phase')).toBeInTheDocument();
  });

  it('select-all checkbox toggles every item when none are selected', () => {
    const onToggleSelect = vi.fn();
    renderGroup({ onToggleSelect });
    fireEvent.click(screen.getByLabelText('Select all items in phase'));
    expect(onToggleSelect).toHaveBeenCalledWith('a');
    expect(onToggleSelect).toHaveBeenCalledWith('b');
  });

  it('select-all when all are selected toggles each off', () => {
    const onToggleSelect = vi.fn();
    renderGroup({
      selectedItems: new Set(['a', 'b']),
      onToggleSelect,
    });
    fireEvent.click(screen.getByLabelText('Select all items in phase'));
    expect(onToggleSelect).toHaveBeenCalledWith('a');
    expect(onToggleSelect).toHaveBeenCalledWith('b');
  });
});
