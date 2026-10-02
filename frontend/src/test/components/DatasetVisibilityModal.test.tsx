import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DatasetVisibilityModal } from '../../components/DatasetVisibilityModal';
import type { Dataset } from '../../lib/schemas';

vi.mock('../../hooks/useBreakpoint', () => ({
  useBreakpoint: () => ({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    breakpoint: 'desktop',
  }),
}));

const ds: Dataset[] = [
  { dataset_id: 'd1', name: 'Alpha', entity_count: 10 } as Dataset,
  { dataset_id: 'd2', name: 'Bravo', entity_count: 5 } as Dataset,
  { dataset_id: 'd3', name: 'Charlie', entity_count: 0 } as Dataset,
];

function renderModal(overrides: Partial<Parameters<typeof DatasetVisibilityModal>[0]> = {}) {
  return render(
    <DatasetVisibilityModal
      isOpen
      onClose={vi.fn()}
      datasets={ds}
      selectedDatasetIds={new Set(['d1', 'd2'])}
      datasetOrder={['d1', 'd2', 'd3']}
      onSave={vi.fn(() => Promise.resolve())}
      {...overrides}
    />,
  );
}

describe('DatasetVisibilityModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when not open', () => {
    const { container } = render(
      <DatasetVisibilityModal
        isOpen={false}
        onClose={vi.fn()}
        datasets={ds}
        selectedDatasetIds={new Set()}
        datasetOrder={[]}
        onSave={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the title and helper text when open', () => {
    renderModal();
    expect(screen.getByText('Dataset visibility')).toBeInTheDocument();
    expect(
      screen.getByText('Drag to reorder. Toggle visibility with the checkbox.'),
    ).toBeInTheDocument();
  });

  it('renders each dataset with name and entity count', () => {
    renderModal();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Bravo')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
    expect(screen.getByText('10 entities')).toBeInTheDocument();
  });

  it('renders empty state when no datasets are provided', () => {
    renderModal({ datasets: [], datasetOrder: [], selectedDatasetIds: new Set() });
    expect(screen.getByText('No datasets available')).toBeInTheDocument();
  });

  it('renders one checkbox per dataset with correct aria-checked state', () => {
    renderModal();
    const checkboxes = screen.getAllByRole('checkbox', { hidden: true });
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes[0]).toHaveAttribute('aria-checked', 'true'); // d1
    expect(checkboxes[1]).toHaveAttribute('aria-checked', 'true'); // d2
    expect(checkboxes[2]).toHaveAttribute('aria-checked', 'false'); // d3
  });

  it('toggles selection when a checkbox is clicked', () => {
    renderModal();
    const checkboxes = screen.getAllByRole('checkbox', { hidden: true });
    expect(checkboxes[2]).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(checkboxes[2]);
    expect(checkboxes[2]).toHaveAttribute('aria-checked', 'true');
  });

  it('disables the "Clear selection" button when nothing is selected', () => {
    renderModal({ selectedDatasetIds: new Set() });
    const clear = screen.getByRole('button', { name: 'Clear selection', hidden: true });
    expect(clear).toBeDisabled();
  });

  it('clears all selections when "Clear selection" is clicked', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection', hidden: true }));
    const checkboxes = screen.getAllByRole('checkbox', { hidden: true });
    checkboxes.forEach((cb) => {
      expect(cb).toHaveAttribute('aria-checked', 'false');
    });
  });

  it('calls onSave with the current selection on Apply', async () => {
    const onSave = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    renderModal({ onSave, onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Apply', hidden: true }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [savedIds, savedOrder] = onSave.mock.calls[0];
    expect(savedIds).toEqual(new Set(['d1', 'd2']));
    expect(savedOrder).toEqual(['d1', 'd2', 'd3']);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the "large selections" hint when more than 5 are selected', () => {
    renderModal({
      selectedDatasetIds: new Set(['d1', 'd2', 'd3', 'd4', 'd5', 'd6']),
    });
    expect(
      screen.getByText('Large selections may reduce clarity.'),
    ).toBeInTheDocument();
  });

  it('calls onClose when the X button is clicked', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Close', hidden: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('toggles via keyboard Enter on the checkbox', () => {
    renderModal();
    const checkboxes = screen.getAllByRole('checkbox', { hidden: true });
    expect(checkboxes[2]).toHaveAttribute('aria-checked', 'false');
    fireEvent.keyDown(checkboxes[2], { key: 'Enter' });
    expect(checkboxes[2]).toHaveAttribute('aria-checked', 'true');
  });
});
