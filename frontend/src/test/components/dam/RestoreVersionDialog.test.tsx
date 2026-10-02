import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RestoreVersionDialog } from '../../../components/dam/RestoreVersionDialog';

const { restoreMediaVersionMock } = vi.hoisted(() => ({
  restoreMediaVersionMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  restoreMediaVersion: restoreMediaVersionMock,
}));

vi.mock('@/lib/formatters', () => ({
  formatDateTime: (s: string) => `formatted:${s}`,
}));

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

const baseVersion = {
  version_id: 'v-1',
  version_number: 3,
  file_size: 2048,
  created_at: '2026-04-01T10:00:00Z',
  change_note: null,
} as any;

function renderDialog(props: Partial<Parameters<typeof RestoreVersionDialog>[0]> = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <RestoreVersionDialog
        organizationId="org-1"
        mediaId="m-1"
        version={baseVersion}
        onClose={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('RestoreVersionDialog', () => {
  beforeEach(() => {
    restoreMediaVersionMock.mockReset();
  });

  it('renders the dialog title and the version number', () => {
    renderDialog();
    expect(screen.getByText('Restore Previous Version')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows a formatted file size in KB', () => {
    renderDialog();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
  });

  it('shows a formatted file size in bytes', () => {
    renderDialog({ version: { ...baseVersion, file_size: 512 } });
    expect(screen.getByText('512 B')).toBeInTheDocument();
  });

  it('shows a formatted file size in MB', () => {
    renderDialog({ version: { ...baseVersion, file_size: 5 * 1024 * 1024 } });
    expect(screen.getByText('5.0 MB')).toBeInTheDocument();
  });

  it('renders a change note when provided', () => {
    renderDialog({ version: { ...baseVersion, change_note: 'Cropped image' } });
    expect(screen.getByText('Cropped image')).toBeInTheDocument();
  });

  it('does not render a Note section when change_note is missing', () => {
    renderDialog();
    expect(screen.queryByText('Note')).not.toBeInTheDocument();
  });

  it('uses formatDateTime for the created_at field', () => {
    renderDialog();
    expect(screen.getByText(/formatted:2026-04-01T10:00:00Z/)).toBeInTheDocument();
  });

  it('shows "Unknown date" when created_at is null', () => {
    renderDialog({ version: { ...baseVersion, created_at: null } });
    expect(screen.getByText('Unknown date')).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', hidden: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls restoreMediaVersion and onClose on success', async () => {
    restoreMediaVersionMock.mockResolvedValue({});
    const onClose = vi.fn();
    renderDialog({ onClose });
    fireEvent.click(screen.getByRole('button', { name: /Restore Version/, hidden: true }));
    await waitFor(() =>
      expect(restoreMediaVersionMock).toHaveBeenCalledWith('org-1', 'm-1', 'v-1'),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('renders the API error inline on failure', async () => {
    restoreMediaVersionMock.mockRejectedValue(new Error('boom!'));
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /Restore Version/, hidden: true }));
    await waitFor(() => expect(screen.getByText('boom!')).toBeInTheDocument());
  });
});
