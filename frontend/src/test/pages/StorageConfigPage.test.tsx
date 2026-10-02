import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StorageConfigPage from '../../pages/admin/StorageConfigPage';
import * as useOrgHook from '../../contexts/useOrganization';
import * as apiClient from '../../lib/apiClient';

vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(),
}));

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

const mockUseOrg = vi.mocked(useOrgHook.useOrganization);
const mockApiFetch = vi.mocked(apiClient.apiFetch);

function renderPage(orgId = 'org-1') {
  mockUseOrg.mockReturnValue({ activeOrganizationId: orgId } as any);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/admin/storage`]}>
        <Routes>
          <Route path="/organizations/:orgId/admin/storage" element={<StorageConfigPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StorageConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders page header', async () => {
      mockApiFetch.mockResolvedValue({
        provider: 'managed',
        is_verified: true,
        verified_at: null,
        verification_error: null,
        cdn_domain: null,
        has_cdn_signing_key: false,
        created_at: null,
        updated_at: null,
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Storage Configuration/i })).toBeInTheDocument();
      });
    });


    it('shows connected status when verified', async () => {
      mockApiFetch.mockResolvedValue({
        provider: 'managed',
        is_verified: true,
        verified_at: '2026-04-01T00:00:00Z',
        verification_error: null,
        cdn_domain: null,
        has_cdn_signing_key: false,
        created_at: null,
        updated_at: null,
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Connected/i)).toBeInTheDocument();
      });
    });

    it('shows not verified status when unverified', async () => {
      mockApiFetch.mockResolvedValue({
        provider: 's3',
        bucket: 'test-bucket',
        region: 'us-west-2',
        is_verified: false,
        verified_at: null,
        verification_error: 'Bucket not found',
        cdn_domain: null,
        has_cdn_signing_key: false,
        created_at: null,
        updated_at: null,
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Not verified/i)).toBeInTheDocument();
      });
    });

    it('shows bucket info when configured', async () => {
      mockApiFetch.mockResolvedValue({
        provider: 's3',
        bucket: 'my-bucket',
        region: 'us-east-1',
        is_verified: true,
        verified_at: '2026-04-01T00:00:00Z',
        verification_error: null,
        cdn_domain: null,
        has_cdn_signing_key: false,
        created_at: null,
        updated_at: null,
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('my-bucket')).toBeInTheDocument();
      });
      expect(screen.getByText('us-east-1')).toBeInTheDocument();
    });
  });

  describe('provider selection', () => {
    beforeEach(() => {
      mockApiFetch.mockResolvedValue({
        provider: 'managed',
        is_verified: true,
        verified_at: null,
        verification_error: null,
        cdn_domain: null,
        has_cdn_signing_key: false,
        created_at: null,
        updated_at: null,
      });
    });

    it('shows S3 form when S3 is selected', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('AWS S3')).toBeInTheDocument();
      });

      // Click S3 provider button
      fireEvent.click(screen.getByText('AWS S3').closest('button')!);

      await waitFor(() => {
        expect(screen.getByText(/AWS S3 Configuration/i)).toBeInTheDocument();
      });
    });

    it('shows the endpoint URL field when S3-compatible is selected', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('S3-Compatible')).toBeInTheDocument();
      });

      // Click the S3-compatible provider button
      const compatibleBtn = screen.getByText('S3-Compatible').closest('button');
      fireEvent.click(compatibleBtn!);

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/s3.example.com/i)).toBeInTheDocument();
      });
    });
  });

  describe('loading state', () => {
    it('shows loader while fetching config', () => {
      mockApiFetch.mockImplementation(() => new Promise(() => {}));

      const { container } = renderPage();

      // MadronaLoader renders an svg with role
      expect(container.querySelector('.flex.items-center.justify-center')).not.toBeNull();
    });
  });
});
