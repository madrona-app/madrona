import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CheckCircle, Circle, XCircle } from 'lucide-react';
import { ChangeStatusDropdown } from '../../components/collections/ChangeStatusDropdown';

const STATUSES = [
  { key: 'draft', label: 'Draft' },
  { key: 'approved', label: 'Approved' },
  { key: 'cancelled', label: 'Cancelled' },
];

const STATUS_CONFIG = {
  draft: { label: 'Draft', color: 'stone', icon: Circle },
  approved: { label: 'Approved', color: 'semantic-success', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'semantic-error', icon: XCircle },
};

function renderDropdown(
  overrides: Partial<Parameters<typeof ChangeStatusDropdown>[0]> = {}
) {
  return render(
    <ChangeStatusDropdown
      currentStatus="draft"
      allStatuses={STATUSES}
      statusConfig={STATUS_CONFIG}
      onStatusChange={vi.fn()}
      isPending={false}
      {...overrides}
    />
  );
}

describe('ChangeStatusDropdown', () => {
  it('renders the trigger button', () => {
    renderDropdown();
    expect(screen.getByRole('button', { name: /Change Status/i })).toBeInTheDocument();
  });

  it('does not render options until the trigger is clicked', () => {
    renderDropdown();
    expect(screen.queryByRole('button', { name: 'Approved' })).not.toBeInTheDocument();
  });

  it('opens the menu with options on click, excluding current status', () => {
    renderDropdown();
    fireEvent.click(screen.getByRole('button', { name: /Change Status/i }));
    // Current status "draft" should be filtered out
    expect(screen.queryByRole('button', { name: 'Draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approved' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelled' })).toBeInTheDocument();
  });

  it('calls onStatusChange with the selected status and closes the menu', () => {
    const onStatusChange = vi.fn();
    renderDropdown({ onStatusChange });
    fireEvent.click(screen.getByRole('button', { name: /Change Status/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Approved' }));
    expect(onStatusChange).toHaveBeenCalledWith('approved');
    // Menu closes after selection
    expect(screen.queryByRole('button', { name: 'Cancelled' })).not.toBeInTheDocument();
  });

  it('disables the trigger when pending', () => {
    renderDropdown({ isPending: true });
    expect(screen.getByRole('button', { name: /Change Status/i })).toBeDisabled();
  });

  it('styles destructive side statuses with error color', () => {
    renderDropdown({ sideStatuses: ['cancelled'] });
    fireEvent.click(screen.getByRole('button', { name: /Change Status/i }));
    const cancelledButton = screen.getByRole('button', { name: 'Cancelled' });
    expect(cancelledButton.className).toContain('text-semantic-error');
    // Non-side statuses should not receive the destructive class
    const approvedButton = screen.getByRole('button', { name: 'Approved' });
    expect(approvedButton.className).not.toContain('text-semantic-error');
  });

  it('closes the menu when clicking outside', () => {
    renderDropdown();
    fireEvent.click(screen.getByRole('button', { name: /Change Status/i }));
    expect(screen.getByRole('button', { name: 'Approved' })).toBeInTheDocument();
    // Simulate a click outside the dropdown
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('button', { name: 'Approved' })).not.toBeInTheDocument();
  });
});
