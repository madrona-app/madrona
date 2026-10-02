import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VersionHistoryTab } from '../../../components/dam/VersionHistoryTab';

vi.mock('../../../lib/api', () => ({
  getMediaVersions: vi.fn(),
}));

// Mock children that have heavy dependencies
vi.mock('../../../components/dam/UploadVersionModal', () => ({
  UploadVersionModal: () => <div data-testid="upload-version-modal" />,
}));

vi.mock('../../../components/dam/RestoreVersionDialog', () => ({
  RestoreVersionDialog: () => <div data-testid="restore-version-dialog" />,
}));

vi.mock('../../../components/dam/VersionComparisonView', () => ({
  VersionComparisonView: () => <div data-testid="version-comparison" />,
}));

import { getMediaVersions } from '../../../lib/api';
const mockGet = vi.mocked(getMediaVersions);

function renderTab(props?: Partial<Parameters<typeof VersionHistoryTab>[0]>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <VersionHistoryTab
        organizationId="org-1"
        mediaId="m-1"
        currentVersion={2}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('VersionHistoryTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows loading state initially', () => {
    mockGet.mockReturnValue(new Promise(() => {}) as never);
    renderTab();
    // MadronaLoader is rendered initially — just check the heading isn't there yet
    expect(screen.queryByText('Version History')).not.toBeInTheDocument();
  });

  it('renders Version History heading after data loads', async () => {
    mockGet.mockResolvedValue({ versions: [] } as never);
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('Version History')).toBeInTheDocument();
    });
  });

  it('shows current version label', async () => {
    mockGet.mockResolvedValue({ versions: [] } as never);
    renderTab({ currentVersion: 5 });
    await waitFor(() => {
      expect(screen.getByText('Version 5')).toBeInTheDocument();
    });
  });

  it('shows empty state when no previous versions', async () => {
    mockGet.mockResolvedValue({ versions: [] } as never);
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('No previous versions available')).toBeInTheDocument();
    });
  });

  it('renders version list with file sizes', async () => {
    mockGet.mockResolvedValue({
      versions: [
        { version_id: 'v-1', version_number: 1, file_size: 2048, created_at: '2025-01-01T00:00:00Z' },
        { version_id: 'v-3', version_number: 3, file_size: 4096, created_at: '2025-01-02T00:00:00Z' },
      ],
    } as never);
    renderTab({ currentVersion: 2 });
    await waitFor(() => {
      expect(screen.getByText('Version 1')).toBeInTheDocument();
      expect(screen.getByText('Version 3')).toBeInTheDocument();
    });
  });

  it('shows change_note when present', async () => {
    mockGet.mockResolvedValue({
      versions: [
        {
          version_id: 'v-1',
          version_number: 1,
          file_size: 100,
          created_at: '2025-01-01T00:00:00Z',
          change_note: 'Color correction',
        },
      ],
    } as never);
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('Color correction')).toBeInTheDocument();
    });
  });

  it('renders Compare and Restore buttons for non-current versions', async () => {
    mockGet.mockResolvedValue({
      versions: [
        { version_id: 'v-1', version_number: 1, file_size: 100, created_at: '2025-01-01T00:00:00Z' },
      ],
    } as never);
    renderTab({ currentVersion: 2 });
    await waitFor(() => {
      expect(screen.getByText('Compare')).toBeInTheDocument();
      expect(screen.getByText('Restore')).toBeInTheDocument();
    });
  });

  it('shows error state when fetch fails', async () => {
    mockGet.mockRejectedValue(new Error('boom'));
    renderTab();
    await waitFor(() => {
      expect(screen.getByText(/Error loading version history/)).toBeInTheDocument();
    });
  });

  it('opens upload modal when "Upload New Version" clicked', async () => {
    mockGet.mockResolvedValue({ versions: [] } as never);
    renderTab();
    await waitFor(() => screen.getByText('Upload New Version'));
    fireEvent.click(screen.getByText('Upload New Version'));
    expect(screen.getByTestId('upload-version-modal')).toBeInTheDocument();
  });

  it('opens RestoreVersionDialog when Restore clicked', async () => {
    mockGet.mockResolvedValue({
      versions: [
        { version_id: 'v-1', version_number: 1, file_size: 100, created_at: '2025-01-01T00:00:00Z' },
      ],
    } as never);
    renderTab({ currentVersion: 2 });
    await waitFor(() => screen.getByText('Restore'));
    fireEvent.click(screen.getByText('Restore'));
    expect(screen.getByTestId('restore-version-dialog')).toBeInTheDocument();
  });
});
