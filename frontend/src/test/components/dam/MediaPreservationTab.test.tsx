import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MediaPreservationTab from '../../../components/dam/MediaPreservationTab';

vi.mock('../../../lib/api/preservation', () => ({
  getMediaPreservationEvents: vi.fn(),
  getMediaReplicas: vi.fn(),
  getMediaInfoPackages: vi.fn(),
  getAIPManifest: vi.fn(),
}));

import {
  getMediaPreservationEvents,
  getMediaReplicas,
  getMediaInfoPackages,
} from '../../../lib/api/preservation';

const mockEvents = vi.mocked(getMediaPreservationEvents);
const mockReplicas = vi.mocked(getMediaReplicas);
const mockPackages = vi.mocked(getMediaInfoPackages);

function renderTab(props?: Partial<Parameters<typeof MediaPreservationTab>[0]>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MediaPreservationTab organizationId="org-1" mediaId="m-1" {...props} />
    </QueryClientProvider>,
  );
}

describe('MediaPreservationTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEvents.mockResolvedValue({ items: [] } as never);
    mockReplicas.mockResolvedValue({ replicas: [] } as never);
    mockPackages.mockResolvedValue({ items: [] } as never);
  });

  it('renders all section headers', async () => {
    renderTab();
    expect(screen.getByText('Format & Fixity')).toBeInTheDocument();
    expect(screen.getByText('Preservation Events')).toBeInTheDocument();
    expect(screen.getByText('Storage Copies')).toBeInTheDocument();
    expect(screen.getByText('Information Packages')).toBeInTheDocument();
  });

  it('shows format name when given', async () => {
    renderTab({ formatName: 'TIFF' });
    expect(screen.getByText('TIFF')).toBeInTheDocument();
  });

  it('shows "Unknown" when format name is missing', async () => {
    renderTab({ formatName: null });
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('shows PRONOM PUID when given', async () => {
    renderTab({ pronomPuid: 'fmt/353' });
    expect(screen.getByText('fmt/353')).toBeInTheDocument();
  });

  it('renders risk badge with the risk level', async () => {
    renderTab({ formatRiskLevel: 'low' });
    expect(screen.getByText('low')).toBeInTheDocument();
  });

  it('shows risk alert for high-risk formats', async () => {
    renderTab({ formatRiskLevel: 'high' });
    expect(screen.getByText('high', { selector: 'strong' })).toBeInTheDocument();
  });

  it('shows risk alert for critical formats', async () => {
    renderTab({ formatRiskLevel: 'critical' });
    expect(screen.getByText('critical', { selector: 'strong' })).toBeInTheDocument();
  });

  it('does not show risk alert for low risk', async () => {
    renderTab({ formatRiskLevel: 'low' });
    expect(screen.queryByText('low', { selector: 'strong' })).not.toBeInTheDocument();
  });

  it('shows empty preservation events message when none exist', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('No preservation events recorded.')).toBeInTheDocument();
    });
  });

  it('shows empty replicas message when none exist', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('No replicas found.')).toBeInTheDocument();
    });
  });

  it('shows empty information packages message when none exist', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('No information packages created.')).toBeInTheDocument();
    });
  });

  it('shows error message when events query fails', async () => {
    mockEvents.mockRejectedValue(new Error('boom'));
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('Failed to load preservation events')).toBeInTheDocument();
    });
  });
});
