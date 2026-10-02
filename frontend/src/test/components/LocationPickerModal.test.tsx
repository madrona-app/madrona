import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocationPickerModal } from '../../components/collections/LocationPickerModal';

// Mock the API
vi.mock('../../lib/api', () => ({
  getLocations: vi.fn(() => Promise.resolve({
    locations: [
      {
        location_id: 'loc-1',
        name: 'Main Building',
        location_type: 'building',
        status: 'active',
        parent_id: null,
        path: 'Main Building',
        code: 'MB',
        on_display: false,
      },
      {
        location_id: 'loc-2',
        name: 'Gallery A',
        location_type: 'room',
        status: 'active',
        parent_id: 'loc-1',
        path: 'Main Building > Gallery A',
        code: null,
        on_display: true,
      },
      {
        location_id: 'loc-3',
        name: 'Storage Room',
        location_type: 'room',
        status: 'active',
        parent_id: 'loc-1',
        path: 'Main Building > Storage Room',
        code: null,
        on_display: false,
      },
    ],
  })),
}));

// Mock useAccessibleModal
vi.mock('../../hooks/useAccessibleModal', () => ({
  useAccessibleModal: ({ titlePrefix }: { isOpen: boolean; onClose: () => void; titlePrefix: string }) => ({
    modalRef: { current: null },
    titleId: `${titlePrefix}-title`,
  }),
  getModalAriaProps: (titleId: string) => ({
    role: 'dialog',
    'aria-modal': true,
    'aria-labelledby': titleId,
  }),
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function renderModal(props?: Partial<Parameters<typeof LocationPickerModal>[0]>) {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <LocationPickerModal
        isOpen
        onClose={vi.fn()}
        onSelect={vi.fn()}
        organizationId="org-1"
        {...props}
      />
    </QueryClientProvider>
  );
}

describe('LocationPickerModal', () => {
  it('renders nothing when closed', () => {
    const queryClient = createQueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <LocationPickerModal
          isOpen={false}
          onClose={vi.fn()}
          onSelect={vi.fn()}
          organizationId="org-1"
        />
      </QueryClientProvider>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders title when open', async () => {
    renderModal();
    expect(screen.getByText('Select Location')).toBeInTheDocument();
  });

  it('renders custom title', () => {
    renderModal({ title: 'Choose Storage' });
    expect(screen.getByText('Choose Storage')).toBeInTheDocument();
  });

  it('renders search input', () => {
    renderModal();
    expect(screen.getByPlaceholderText('Search locations...')).toBeInTheDocument();
  });

  it('renders close button', () => {
    renderModal();
    expect(screen.getByLabelText('Close')).toBeInTheDocument();
  });

  it('renders cancel button in footer', () => {
    renderModal();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when cancel button is clicked', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders dialog with accessible role', () => {
    renderModal();
    // The dialog is rendered inside a portal; the outer backdrop is aria-hidden
    // so we query by role with hidden option
    expect(screen.getByRole('dialog', { hidden: true })).toBeInTheDocument();
  });
});
