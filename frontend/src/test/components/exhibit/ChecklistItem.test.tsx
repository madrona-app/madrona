import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChecklistItemRow } from '../../../components/exhibit/ExhibitionChecklistTab/ChecklistItem';
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

vi.mock('../../../components/exhibit/ExhibitionChecklistTab/StatusDropdown', () => ({
  StatusDropdown: ({
    currentStatus,
    onStatusChange,
    disabled,
  }: {
    currentStatus: string;
    onStatusChange: (s: string) => void;
    disabled?: boolean;
  }) => (
    <button
      data-testid="status-dropdown"
      data-status={currentStatus}
      disabled={disabled}
      onClick={() => onStatusChange('done')}
    >
      Status:{currentStatus}
    </button>
  ),
}));

const baseItem: ChecklistItem = {
  item_id: 'i-1',
  phase: 'planning',
  title: 'Schedule kickoff meeting',
  description: 'Coordinate with curatorial team',
  responsible_role: 'curator',
  assigned_user_id: null,
  assigned_user_name: null,
  due_date: null,
  status: 'todo',
  notes: null,
  sort_order: 0,
  links_count: 0,
  created_at: '',
  updated_at: '',
  completed_at: null,
  completed_by: null,
};

function setup(item: Partial<ChecklistItem> = {}, isSelected = false, canEdit = true) {
  const onStatusChange = vi.fn();
  const onItemClick = vi.fn();
  const onToggleSelect = vi.fn();
  const utils = render(
    <table>
      <tbody>
        <ChecklistItemRow
          item={{ ...baseItem, ...item }}
          onStatusChange={onStatusChange}
          onItemClick={onItemClick}
          isSelected={isSelected}
          onToggleSelect={onToggleSelect}
          canEdit={canEdit}
        />
      </tbody>
    </table>,
  );
  return { onStatusChange, onItemClick, onToggleSelect, ...utils };
}

describe('ChecklistItemRow', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('renders the title and description', () => {
    setup();
    expect(screen.getByText('Schedule kickoff meeting')).toBeInTheDocument();
    expect(screen.getByText('Coordinate with curatorial team')).toBeInTheDocument();
  });

  it('shows the role label when no assignee is set', () => {
    setup();
    expect(screen.getByText('Curator')).toBeInTheDocument();
  });

  it('prefers the assigned user name when present', () => {
    setup({ assigned_user_name: 'Jane Doe' });
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.queryByText('Curator')).toBeNull();
  });

  it('shows "-" when there is no due date', () => {
    setup();
    expect(screen.getByText('-')).toBeInTheDocument();
  });

  it('renders a formatted due date when present', () => {
    setup({ due_date: '2099-06-15' });
    // formatDateShort produces something like "Jun 15, 2099"
    expect(screen.getByText(/2099/)).toBeInTheDocument();
  });

  it('marks overdue items in semantic-error', () => {
    const { container } = setup({ due_date: '2000-01-01', status: 'todo' });
    expect(container.querySelector('.text-semantic-error')).not.toBeNull();
  });

  it('does not mark done items as overdue', () => {
    const { container } = setup({ due_date: '2000-01-01', status: 'done' });
    expect(container.querySelector('.text-semantic-error')).toBeNull();
  });

  it('clicking the title button calls onItemClick with the item', () => {
    const { onItemClick } = setup();
    fireEvent.click(screen.getByText('Schedule kickoff meeting'));
    expect(onItemClick).toHaveBeenCalledTimes(1);
    expect(onItemClick.mock.calls[0][0].item_id).toBe('i-1');
  });

  it('clicking the checkbox calls onToggleSelect with the item id', () => {
    const { onToggleSelect } = setup();
    fireEvent.click(screen.getByLabelText('Select Schedule kickoff meeting'));
    expect(onToggleSelect).toHaveBeenCalledWith('i-1');
  });

  it('clicking the status dropdown calls onStatusChange', () => {
    const { onStatusChange } = setup();
    fireEvent.click(screen.getByTestId('status-dropdown'));
    expect(onStatusChange).toHaveBeenCalledWith('i-1', 'done');
  });

  it('disables the status dropdown when canEdit is false', () => {
    setup({}, false, false);
    expect(screen.getByTestId('status-dropdown')).toBeDisabled();
  });

  it('renders link count when greater than zero', () => {
    setup({ links_count: 3 });
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders notes indicator when notes are present', () => {
    setup({ notes: 'something' });
    expect(screen.getByTitle('Has notes')).toBeInTheDocument();
  });

  it('applies selected styling when isSelected', () => {
    const { container } = setup({}, true);
    expect(container.querySelector('tr')?.className).toContain('bg-bark/5');
  });
});
