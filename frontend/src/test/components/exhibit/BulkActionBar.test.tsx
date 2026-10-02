import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BulkActionBar } from '../../../components/exhibit/ExhibitionChecklistTab/BulkActionBar';

function renderBar(overrides: Partial<Parameters<typeof BulkActionBar>[0]> = {}) {
  const props = {
    selectedCount: 3,
    onMarkDone: vi.fn(),
    onSetDueDate: vi.fn(),
    onClearSelection: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<BulkActionBar {...props} />) };
}

describe('BulkActionBar', () => {
  it('renders nothing when selectedCount is 0', () => {
    const { container } = renderBar({ selectedCount: 0 });
    expect(container.firstChild).toBeNull();
  });

  it('shows selected count label', () => {
    renderBar({ selectedCount: 5 });
    expect(screen.getByText('5 selected')).toBeInTheDocument();
  });

  it('renders Mark Done, Set Due Date, and Clear buttons', () => {
    renderBar();
    expect(screen.getByText('Mark Done')).toBeInTheDocument();
    expect(screen.getByText('Set Due Date')).toBeInTheDocument();
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  it('calls onMarkDone when Mark Done clicked', () => {
    const { props } = renderBar();
    fireEvent.click(screen.getByText('Mark Done'));
    expect(props.onMarkDone).toHaveBeenCalledTimes(1);
  });

  it('calls onSetDueDate when Set Due Date clicked', () => {
    const { props } = renderBar();
    fireEvent.click(screen.getByText('Set Due Date'));
    expect(props.onSetDueDate).toHaveBeenCalledTimes(1);
  });

  it('calls onClearSelection when Clear clicked', () => {
    const { props } = renderBar();
    fireEvent.click(screen.getByText('Clear'));
    expect(props.onClearSelection).toHaveBeenCalledTimes(1);
  });
});
