import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import DataPreviewModal from '../../components/DataPreviewModal';

vi.mock('../../lib/api', () => ({
  previewConnectorData: vi.fn(),
}));

import { previewConnectorData } from '../../lib/api';
const mockPreview = vi.mocked(previewConnectorData);

function renderModal(props?: Partial<Parameters<typeof DataPreviewModal>[0]>) {
  return render(
    <DataPreviewModal
      isOpen
      onClose={vi.fn()}
      instanceId="i-1"
      objectId="o-1"
      objectName="Customers"
      {...props}
    />,
  );
}

describe('DataPreviewModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing when isOpen=false', () => {
    const { container } = renderModal({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it('shows the object name in the title', async () => {
    mockPreview.mockResolvedValue({ columns: [], rows: [], total_count: 0 } as never);
    renderModal();
    await waitFor(() => {
      expect(screen.getByText(/Customers/)).toBeInTheDocument();
    });
  });

  it('calls previewConnectorData when opened', async () => {
    mockPreview.mockResolvedValue({ columns: ['id'], rows: [], total_count: 0 } as never);
    renderModal();
    await waitFor(() => {
      expect(mockPreview).toHaveBeenCalledWith('i-1', expect.objectContaining({ object_id: 'o-1', limit: 25, offset: 0 }));
    });
  });

  it('renders rows in table when data returned', async () => {
    mockPreview.mockResolvedValue({
      columns: ['id', 'name'],
      rows: [{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }],
      total_count: 2,
    } as never);
    renderModal();
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });

  it('shows error message when API fails', async () => {
    mockPreview.mockRejectedValue(new Error('boom'));
    renderModal();
    await waitFor(() => {
      expect(screen.getByText(/boom/)).toBeInTheDocument();
    });
  });

  it('renders column headers', async () => {
    mockPreview.mockResolvedValue({
      columns: ['email', 'phone'],
      rows: [{ email: 'a@x.com', phone: '555-1234' }],
      total_count: 1,
    } as never);
    renderModal();
    await waitFor(() => {
      expect(screen.getByText('email')).toBeInTheDocument();
      expect(screen.getByText('phone')).toBeInTheDocument();
    });
  });

  it('does not load data when isOpen=false', () => {
    renderModal({ isOpen: false });
    expect(mockPreview).not.toHaveBeenCalled();
  });
});
