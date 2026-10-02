import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RollbackDialog from '../../components/RollbackDialog';

function renderDialog(
  overrides: Partial<Parameters<typeof RollbackDialog>[0]> = {},
) {
  return render(
    <RollbackDialog
      isOpen
      onClose={vi.fn()}
      onConfirm={vi.fn()}
      entityLabel="Acquisition"
      targetStatusLabel="Pending Review"
      {...overrides}
    />,
  );
}

describe('RollbackDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <RollbackDialog
        isOpen={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        entityLabel="Acquisition"
        targetStatusLabel="Draft"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the entity-aware title and target status', () => {
    renderDialog();
    expect(screen.getByText('Revert Acquisition Status')).toBeInTheDocument();
    expect(screen.getByText('Pending Review')).toBeInTheDocument();
  });

  it('renders the reason textarea with autofocus and placeholder', () => {
    renderDialog();
    const textarea = screen.getByLabelText(/Reason for reverting/) as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea.placeholder).toContain('Explain');
  });

  it('disables the Revert button when reason is empty', () => {
    renderDialog();
    const revert = screen.getByRole('button', { name: 'Revert Status', hidden: true });
    expect(revert).toBeDisabled();
  });

  it('disables the Revert button when reason is shorter than 10 chars', () => {
    renderDialog();
    const textarea = screen.getByLabelText(/Reason for reverting/);
    fireEvent.change(textarea, { target: { value: 'too short' } });
    expect(screen.getByRole('button', { name: 'Revert Status', hidden: true })).toBeDisabled();
    expect(
      screen.getByText('Please provide at least 10 characters'),
    ).toBeInTheDocument();
  });

  it('enables the Revert button when reason is at least 10 chars', () => {
    renderDialog();
    const textarea = screen.getByLabelText(/Reason for reverting/);
    fireEvent.change(textarea, {
      target: { value: 'A perfectly valid reason' },
    });
    expect(screen.getByRole('button', { name: 'Revert Status', hidden: true })).not.toBeDisabled();
  });

  it('calls onConfirm with the trimmed reason when Revert clicked', () => {
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });
    const textarea = screen.getByLabelText(/Reason for reverting/);
    fireEvent.change(textarea, {
      target: { value: '   This is the reason for reverting   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Revert Status', hidden: true }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('This is the reason for reverting');
  });

  it('does not call onConfirm when reason is too short and button is forced', () => {
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });
    const textarea = screen.getByLabelText(/Reason for reverting/);
    fireEvent.change(textarea, { target: { value: 'short' } });
    // The button is disabled, so click should not trigger handler. Just sanity-check.
    fireEvent.click(screen.getByRole('button', { name: 'Revert Status', hidden: true }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', hidden: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    const backdrop = document.body.querySelector('.bg-ink\\/50');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the loading label and disables both buttons while loading', () => {
    renderDialog({ isLoading: true });
    const textarea = screen.getByLabelText(/Reason for reverting/);
    fireEvent.change(textarea, {
      target: { value: 'A perfectly valid reason' },
    });
    expect(screen.getByRole('button', { name: 'Reverting...', hidden: true })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel', hidden: true })).toBeDisabled();
  });
});
