import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MediaPickerModal } from '../../../components/content/MediaPickerModal';
import * as apiUtils from '../../../lib/api/_utils';

vi.mock('../../../lib/api/_utils', () => ({
  apiFetch: vi.fn(),
  buildQueryString: (p: Record<string, unknown>) => {
    const sp = new URLSearchParams();
    Object.entries(p).forEach(([k, v]) => sp.set(k, String(v)));
    return `?${sp.toString()}`;
  },
}));

vi.mock('../../../hooks/useAccessibleModal', () => ({
  useAccessibleModal: ({ titlePrefix }: { titlePrefix: string }) => ({
    modalRef: { current: null },
    titleId: `${titlePrefix}-title`,
  }),
}));

vi.mock('../../../components/ModalPortal', () => ({
  ModalPortal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockFetch = vi.mocked(apiUtils.apiFetch);

function renderModal(extra: Partial<Parameters<typeof MediaPickerModal>[0]> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MediaPickerModal
        isOpen
        onClose={vi.fn()}
        onSelect={vi.fn()}
        organizationId="org-1"
        {...extra}
      />
    </QueryClientProvider>,
  );
}

describe('MediaPickerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns nothing when isOpen is false', () => {
    const qc = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={qc}>
        <MediaPickerModal
          isOpen={false}
          onClose={vi.fn()}
          onSelect={vi.fn()}
          organizationId="org-1"
        />
      </QueryClientProvider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the loading state, then media items', async () => {
    mockFetch.mockResolvedValue({
      items: [
        {
          media_id: 'm-1',
          original_filename: 'painting.jpg',
          media_type: 'image',
          mime_type: 'image/jpeg',
          file_size: 1024,
          alt_text: 'A painting',
        },
      ],
      total: 1,
    } as never);

    renderModal();
    await waitFor(() => {
      expect(screen.getByAltText('A painting')).toBeInTheDocument();
    });
    expect(screen.getByText('1 item')).toBeInTheDocument();
  });

  it('shows empty state when no items', async () => {
    mockFetch.mockResolvedValue({ items: [], total: 0 } as never);
    renderModal();
    await waitFor(() => {
      expect(screen.getByText('No images found')).toBeInTheDocument();
    });
  });

  it('disables Select button until an item is chosen', async () => {
    mockFetch.mockResolvedValue({
      items: [
        {
          media_id: 'm-1',
          original_filename: 'photo.jpg',
          media_type: 'image',
          mime_type: 'image/jpeg',
          file_size: 1,
          alt_text: 'Photo',
        },
      ],
      total: 1,
    } as never);

    renderModal();

    await waitFor(() => {
      expect(screen.getByAltText('Photo')).toBeInTheDocument();
    });

    const selectBtn = screen.getByRole('button', { name: 'Select' });
    expect(selectBtn).toBeDisabled();

    fireEvent.click(screen.getByAltText('Photo').closest('button')!);
    expect(selectBtn).not.toBeDisabled();
  });

  it('calls onSelect with media id on confirm', async () => {
    mockFetch.mockResolvedValue({
      items: [
        {
          media_id: 'm-1',
          original_filename: 'photo.jpg',
          media_type: 'image',
          mime_type: 'image/jpeg',
          file_size: 1,
          alt_text: 'Photo',
        },
      ],
      total: 1,
    } as never);

    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderModal({ onSelect, onClose });

    await waitFor(() => {
      expect(screen.getByAltText('Photo')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByAltText('Photo').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));

    expect(onSelect).toHaveBeenCalledWith('m-1');
    expect(onClose).toHaveBeenCalled();
  });
});
