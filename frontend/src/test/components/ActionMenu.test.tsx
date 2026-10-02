import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Plus } from 'lucide-react';
import { ActionMenu, buildActionMenuItems } from '../../components/record-detail/ActionMenu';

describe('ActionMenu', () => {
  it('renders nothing when no actions available', () => {
    const { container } = render(<ActionMenu />);
    expect(container.firstChild).toBeNull();
  });

  it('renders trigger button when actions exist', () => {
    render(
      <ActionMenu canCreateTask onCreateTask={vi.fn()} />
    );
    expect(screen.getByLabelText('More actions')).toBeInTheDocument();
  });

  it('toggles dropdown on trigger click', () => {
    render(
      <ActionMenu canCreateTask onCreateTask={vi.fn()} />
    );
    const trigger = screen.getByLabelText('More actions');
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Create Task')).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('calls onCreateTask then closes menu when clicked', () => {
    const onCreate = vi.fn();
    render(<ActionMenu canCreateTask onCreateTask={onCreate} />);
    fireEvent.click(screen.getByLabelText('More actions'));
    fireEvent.click(screen.getByText('Create Task'));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('renders view history when enabled', () => {
    const onView = vi.fn();
    render(<ActionMenu canViewHistory onViewHistory={onView} />);
    fireEvent.click(screen.getByLabelText('More actions'));
    fireEvent.click(screen.getByText('View History'));
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('renders quickActions group', () => {
    render(
      <ActionMenu
        quickActions={[
          { id: 'a', label: 'Movement', icon: Plus, onClick: vi.fn() },
        ]}
      />
    );
    fireEvent.click(screen.getByLabelText('More actions'));
    expect(screen.getByText('Actions')).toBeInTheDocument();
    expect(screen.getByText('Movement')).toBeInTheDocument();
  });

  it('closes on Escape key', () => {
    render(<ActionMenu canCreateTask onCreateTask={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('More actions'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on outside click', () => {
    render(
      <div>
        <ActionMenu canCreateTask onCreateTask={vi.fn()} />
        <div data-testid="outside">outside</div>
      </div>
    );
    fireEvent.click(screen.getByLabelText('More actions'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('skips disabled items on click', () => {
    const onClick = vi.fn();
    render(
      <ActionMenu
        quickActions={[
          {
            id: 'disabled',
            label: 'Disabled Action',
            icon: Plus,
            onClick,
            disabled: true,
          },
        ]}
      />
    );
    fireEvent.click(screen.getByLabelText('More actions'));
    fireEvent.click(screen.getByText('Disabled Action'));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('buildActionMenuItems', () => {
  it('returns empty list when no permissions are granted', () => {
    const items = buildActionMenuItems({}, {});
    expect(items).toEqual([]);
  });

  it('builds movement item when permission + callback provided', () => {
    const onMovement = vi.fn();
    const items = buildActionMenuItems(
      { canCreateMovement: true },
      { onMovementClick: onMovement }
    );
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('movement');
    items[0].onClick();
    expect(onMovement).toHaveBeenCalledTimes(1);
  });

  it('skips items whose callback is missing', () => {
    const items = buildActionMenuItems(
      { canCreateMovement: true, canCreateLoanRequest: true },
      { onMovementClick: vi.fn() } // no loan callback
    );
    expect(items.map((i) => i.id)).toEqual(['movement']);
  });

  it('includes all permitted actions in order', () => {
    const items = buildActionMenuItems(
      {
        canCreateMovement: true,
        canCreateConditionReport: true,
        canCreateIncident: true,
      },
      {
        onMovementClick: vi.fn(),
        onConditionReportClick: vi.fn(),
        onIncidentClick: vi.fn(),
      }
    );
    expect(items.map((i) => i.id)).toEqual(['movement', 'condition', 'incident']);
  });
});
