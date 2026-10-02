import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MediaRightsManager } from '../../../components/dam/MediaRightsManager';

vi.mock('../../../lib/api', () => ({
  listMediaRights: vi.fn(),
  deleteMediaRights: vi.fn(),
}));

vi.mock('../../../components/dam/AddRightsModal', () => ({
  AddRightsModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="add-rights-modal">
        <button onClick={onClose}>close-modal</button>
      </div>
    ) : null,
}));

import { listMediaRights, deleteMediaRights } from '../../../lib/api';
const mockList = vi.mocked(listMediaRights);
const mockDelete = vi.mocked(deleteMediaRights);

function renderManager(overrides?: Partial<Parameters<typeof MediaRightsManager>[0]>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MediaRightsManager organizationId="org-1" mediaId="m-1" {...overrides} />
    </QueryClientProvider>,
  );
}

describe('MediaRightsManager', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows loading skeleton initially', () => {
    mockList.mockReturnValue(new Promise(() => {}) as never);
    const { container } = renderManager();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders header and Add Rights button', async () => {
    mockList.mockResolvedValue({ rights: [] } as never);
    renderManager();
    await waitFor(() => {
      expect(screen.getByText('Rights Information')).toBeInTheDocument();
      expect(screen.getByText('Add Rights')).toBeInTheDocument();
    });
  });

  it('shows empty state when no rights exist', async () => {
    mockList.mockResolvedValue({ rights: [] } as never);
    renderManager();
    await waitFor(() => {
      expect(screen.getByText('No rights information')).toBeInTheDocument();
    });
  });

  it('shows rights list when records exist', async () => {
    mockList.mockResolvedValue({
      rights: [
        {
          rights_id: 'r-1',
          rights_type: 'copyright',
          rights_holder: 'Alice',
          rights_statement: 'Some statement',
          is_active: true,
        },
      ],
    } as never);
    renderManager();
    await waitFor(() => {
      expect(screen.getByText('Copyright')).toBeInTheDocument();
      expect(screen.getByText(/Holder: Alice/)).toBeInTheDocument();
      expect(screen.getByText('Some statement')).toBeInTheDocument();
    });
  });

  it('shows license type badge when present', async () => {
    mockList.mockResolvedValue({
      rights: [{ rights_id: 'r-1', rights_type: 'license', license_type: 'CC-BY', is_active: true }],
    } as never);
    renderManager();
    await waitFor(() => {
      expect(screen.getByText('CC Attribution')).toBeInTheDocument();
    });
  });

  it('opens AddRightsModal when Add Rights clicked', async () => {
    mockList.mockResolvedValue({ rights: [] } as never);
    renderManager();
    await waitFor(() => screen.getByText('Add Rights'));
    fireEvent.click(screen.getByText('Add Rights'));
    expect(screen.getByTestId('add-rights-modal')).toBeInTheDocument();
  });

  it('shows error state on fetch failure', async () => {
    mockList.mockRejectedValue(new Error('boom'));
    renderManager();
    await waitFor(() => {
      expect(screen.getByText('Failed to load rights records')).toBeInTheDocument();
    });
  });

  it('shows Inactive badge for inactive rights', async () => {
    mockList.mockResolvedValue({
      rights: [{ rights_id: 'r-1', rights_type: 'copyright', is_active: false }],
    } as never);
    renderManager();
    await waitFor(() => {
      expect(screen.getByText('Inactive')).toBeInTheDocument();
    });
  });

  it('shows usage restrictions chips', async () => {
    mockList.mockResolvedValue({
      rights: [
        { rights_id: 'r-1', rights_type: 'restriction', usage_restrictions: ['no-commercial', 'attribution'], is_active: true },
      ],
    } as never);
    renderManager();
    await waitFor(() => {
      expect(screen.getByText('no-commercial')).toBeInTheDocument();
      expect(screen.getByText('attribution')).toBeInTheDocument();
    });
  });

  it('opens confirmation when delete clicked', async () => {
    mockList.mockResolvedValue({
      rights: [{ rights_id: 'r-1', rights_type: 'copyright', is_active: true }],
    } as never);
    mockDelete.mockResolvedValue({} as never);
    renderManager();
    await waitFor(() => screen.getByTitle('Delete'));
    fireEvent.click(screen.getByTitle('Delete'));
    // ConfirmDialog should show
    expect(screen.getByText('Delete Rights Record')).toBeInTheDocument();
  });
});
