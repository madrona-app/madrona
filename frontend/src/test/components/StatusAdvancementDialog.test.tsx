import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  StatusAdvancementDialog,
  StatusRequirementsTooltip,
} from '../../components/collections/StatusAdvancementDialog';
import type { ValidationResult } from '../../lib/procedureValidation';

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

const validResult: ValidationResult = { valid: true, errors: [], warnings: [] };
const invalidResult: ValidationResult = {
  valid: false,
  errors: ['Object name is required', 'Acquisition method is required'],
  warnings: ['Add a description'],
};

function renderDialog(overrides: Partial<Parameters<typeof StatusAdvancementDialog>[0]> = {}) {
  return render(
    <StatusAdvancementDialog
      isOpen
      onClose={vi.fn()}
      onConfirm={vi.fn()}
      currentStatus="received"
      targetStatus="processed"
      targetStatusLabel="Processed"
      validation={validResult}
      {...overrides}
    />,
  );
}

describe('StatusAdvancementDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = renderDialog({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it('shows confirmation header when validation passes', () => {
    renderDialog();
    expect(screen.getByText('Confirm Status Change')).toBeInTheDocument();
    expect(screen.getByText(/All requirements are met/)).toBeInTheDocument();
  });

  it('shows blocking header and error list when invalid', () => {
    renderDialog({ validation: invalidResult });
    expect(screen.getByText('Cannot Change Status')).toBeInTheDocument();
    expect(screen.getByText('Object name is required')).toBeInTheDocument();
    expect(screen.getByText('Acquisition method is required')).toBeInTheDocument();
  });

  it('shows warnings when present', () => {
    renderDialog({ validation: invalidResult });
    expect(screen.getByText('Recommendations:')).toBeInTheDocument();
    expect(screen.getByText('Add a description')).toBeInTheDocument();
  });

  it('renders confirm button only when valid, with target label', () => {
    renderDialog();
    expect(
      screen.getByRole('button', { name: 'Change to Processed', hidden: true }),
    ).toBeInTheDocument();
  });

  it('does not render confirm button when invalid', () => {
    renderDialog({ validation: invalidResult });
    expect(
      screen.queryByRole('button', { name: /Change to/, hidden: true }),
    ).not.toBeInTheDocument();
  });

  it('calls onConfirm when confirm clicked', () => {
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });
    fireEvent.click(screen.getByRole('button', { name: 'Change to Processed', hidden: true }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables the confirm button while loading', () => {
    renderDialog({ isLoading: true });
    const btn = screen.getByRole('button', { name: 'Updating...', hidden: true });
    expect(btn).toBeDisabled();
  });

  it('renders close button that triggers onClose', () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    // The cancel/close action button at footer
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', hidden: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses "Close" footer label when invalid', () => {
    renderDialog({ validation: invalidResult });
    expect(screen.getByRole('button', { name: 'Close', hidden: true })).toBeInTheDocument();
  });

  it('renders Advance with Exception button only when invalid AND callback provided', () => {
    const onAdvanceWithException = vi.fn();
    renderDialog({ validation: invalidResult, onAdvanceWithException });
    const btn = screen.getByRole('button', { name: 'Advance with Exception', hidden: true });
    fireEvent.click(btn);
    expect(onAdvanceWithException).toHaveBeenCalledTimes(1);
  });

  it('hides Advance with Exception button when valid even with callback', () => {
    renderDialog({ onAdvanceWithException: vi.fn() });
    expect(
      screen.queryByRole('button', { name: 'Advance with Exception', hidden: true }),
    ).not.toBeInTheDocument();
  });

  it('hides Advance with Exception button when invalid but no callback', () => {
    renderDialog({ validation: invalidResult });
    expect(
      screen.queryByRole('button', { name: 'Advance with Exception', hidden: true }),
    ).not.toBeInTheDocument();
  });
});

describe('StatusRequirementsTooltip', () => {
  it('renders only children when validation is valid', () => {
    render(
      <StatusRequirementsTooltip
        targetStatus="processed"
        targetStatusLabel="Processed"
        validation={validResult}
      >
        <button>Advance</button>
      </StatusRequirementsTooltip>,
    );
    expect(screen.getByRole('button', { name: 'Advance' })).toBeInTheDocument();
    expect(screen.queryByText('Required for Processed:')).not.toBeInTheDocument();
  });

  it('renders the requirements list when validation has errors', () => {
    render(
      <StatusRequirementsTooltip
        targetStatus="processed"
        targetStatusLabel="Processed"
        validation={invalidResult}
      >
        <button>Advance</button>
      </StatusRequirementsTooltip>,
    );
    expect(screen.getByText('Required for Processed:')).toBeInTheDocument();
    expect(screen.getByText(/Object name is required/)).toBeInTheDocument();
    expect(screen.getByText(/Acquisition method is required/)).toBeInTheDocument();
  });

  it('truncates the list to 5 items with overflow count', () => {
    const manyErrors: ValidationResult = {
      valid: false,
      errors: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'],
      warnings: [],
    };
    render(
      <StatusRequirementsTooltip
        targetStatus="processed"
        targetStatusLabel="Processed"
        validation={manyErrors}
      >
        <span>trigger</span>
      </StatusRequirementsTooltip>,
    );
    expect(screen.getByText('+2 more...')).toBeInTheDocument();
  });
});
