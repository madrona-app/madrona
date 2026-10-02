import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SaveSearchAsWorkSetDialog from '../../../components/workspaces/SaveSearchAsWorkSetDialog';

vi.mock('../../../lib/api', () => ({
  createWorkspace: vi.fn(),
}));

vi.mock('../../../contexts/useOrganization', () => ({
  useOrganization: () => ({ activeOrganization: { organization_id: 'org-1' } }),
}));

import { createWorkspace } from '../../../lib/api';
const mockCreate = vi.mocked(createWorkspace);

function renderDialog(props?: Partial<Parameters<typeof SaveSearchAsWorkSetDialog>[0]>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SaveSearchAsWorkSetDialog isOpen onClose={vi.fn()} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SaveSearchAsWorkSetDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing when isOpen=false', () => {
    const { container } = renderDialog({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it('shows the title', () => {
    renderDialog();
    expect(screen.getByText('Save as Work Set')).toBeInTheDocument();
  });

  it('shows "All objects (no filters)" when no search/filters given', () => {
    renderDialog();
    expect(screen.getByText('All objects (no filters)')).toBeInTheDocument();
  });

  it('shows search query summary', () => {
    renderDialog({ searchQuery: 'vase' });
    expect(screen.getByText('Search: "vase"')).toBeInTheDocument();
  });

  it('shows filter summary lines', () => {
    renderDialog({
      filters: { object_type: ['painting'], on_display: true } as never,
    });
    expect(screen.getByText('Type: painting')).toBeInTheDocument();
    expect(screen.getByText('On display')).toBeInTheDocument();
  });

  it('shows match count when resultCount given', () => {
    renderDialog({ resultCount: 42 });
    expect(screen.getByText(/Currently 42 matching objects/)).toBeInTheDocument();
  });

  it('disables Create when name is empty', () => {
    renderDialog();
    expect(screen.getByText('Create Work Set')).toBeDisabled();
  });

  it('enables Create when name is provided', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('Work Set Name'), { target: { value: 'My Set' } });
    expect(screen.getByText('Create Work Set')).not.toBeDisabled();
  });

  it('triggers createWorkspace on submit', async () => {
    mockCreate.mockResolvedValue({ workspace_id: 'w-1' } as never);
    renderDialog({ searchQuery: 'foo' });
    fireEvent.change(screen.getByLabelText('Work Set Name'), { target: { value: 'Set A' } });
    fireEvent.click(screen.getByText('Create Work Set'));
    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalled();
    });
  });

  it('shows success state after create', async () => {
    mockCreate.mockResolvedValue({ workspace_id: 'w-1' } as never);
    renderDialog();
    fireEvent.change(screen.getByLabelText('Work Set Name'), { target: { value: 'A' } });
    fireEvent.click(screen.getByText('Create Work Set'));
    await waitFor(() => {
      expect(screen.getByText('Work Set Created')).toBeInTheDocument();
    });
  });

  it('calls onClose via Cancel button', () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});
