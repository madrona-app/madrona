import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdvanceWithExceptionDialog } from '../../components/collections/AdvanceWithExceptionDialog';
import type { RequirementResult } from '../../lib/procedureComplianceUtils';

vi.mock('../../hooks/useAccessibleModal', () => ({
  useAccessibleModal: ({ titlePrefix }: { titlePrefix: string }) => ({
    modalRef: { current: null },
    titleId: `${titlePrefix}-title`,
    descriptionId: `${titlePrefix}-desc`,
  }),
  getModalAriaProps: (titleId: string, descriptionId: string) => ({
    role: 'dialog',
    'aria-modal': true,
    'aria-labelledby': titleId,
    'aria-describedby': descriptionId,
  }),
}));

vi.mock('../../components/ModalPortal', () => ({
  ModalPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const blockingRequirements: RequirementResult[] = [
  {
    requirement: {
      id: 'req-1',
      label: 'Object name',
      groupId: 'identification',
      fieldPaths: ['object_name'],
      requiredForStatuses: ['processed'],
      severity: 'blocking',
      helpText: 'A descriptive name for the object',
    },
    satisfied: false,
    missingFields: ['object_name'],
  },
  {
    requirement: {
      id: 'req-2',
      label: 'Acquisition method',
      groupId: 'acquisition',
      fieldPaths: ['acquisition_method'],
      requiredForStatuses: ['processed'],
      severity: 'blocking',
    },
    satisfied: false,
    missingFields: ['acquisition_method'],
  },
];

function renderDialog(overrides: Partial<Parameters<typeof AdvanceWithExceptionDialog>[0]> = {}) {
  return render(
    <AdvanceWithExceptionDialog
      isOpen
      onClose={vi.fn()}
      onConfirm={vi.fn()}
      currentStatus="received"
      targetStatus="processed"
      targetStatusLabel="Processed"
      blockingRequirements={blockingRequirements}
      {...overrides}
    />,
  );
}

describe('AdvanceWithExceptionDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = renderDialog({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it('renders title and target status', () => {
    renderDialog();
    expect(screen.getByRole('heading', { name: 'Advance with Exception' })).toBeInTheDocument();
    expect(screen.getByText('Processed')).toBeInTheDocument();
  });

  it('lists blocking requirement labels and help text', () => {
    renderDialog();
    expect(screen.getByText('Object name')).toBeInTheDocument();
    expect(screen.getByText('A descriptive name for the object')).toBeInTheDocument();
    expect(screen.getByText('Acquisition method')).toBeInTheDocument();
  });

  it('disables the confirm button when reason is empty', () => {
    renderDialog();
    const confirmBtn = screen.getByRole('button', { name: 'Advance with Exception', hidden: true });
    expect(confirmBtn).toBeDisabled();
  });

  it('disables the confirm button while reason is below minimum length', () => {
    renderDialog();
    const textarea = screen.getByLabelText(/Reason for exception/i);
    fireEvent.change(textarea, { target: { value: 'short' } });
    const confirmBtn = screen.getByRole('button', { name: 'Advance with Exception', hidden: true });
    expect(confirmBtn).toBeDisabled();
  });

  it('enables the confirm button once reason meets minimum length', () => {
    renderDialog();
    const textarea = screen.getByLabelText(/Reason for exception/i);
    fireEvent.change(textarea, { target: { value: 'Lender authorized verbally' } });
    const confirmBtn = screen.getByRole('button', { name: 'Advance with Exception', hidden: true });
    expect(confirmBtn).not.toBeDisabled();
  });

  it('calls onConfirm with trimmed reason and bypassed ids', () => {
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });
    const textarea = screen.getByLabelText(/Reason for exception/i);
    fireEvent.change(textarea, { target: { value: '  Documented in correspondence file  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Advance with Exception', hidden: true }));
    expect(onConfirm).toHaveBeenCalledWith('Documented in correspondence file', ['req-1', 'req-2']);
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', hidden: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows loading label and disables actions when isLoading', () => {
    renderDialog({ isLoading: true });
    expect(
      screen.getByRole('button', { name: 'Processing...', hidden: true }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel', hidden: true })).toBeDisabled();
  });
});
