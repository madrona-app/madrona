import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ServerManagementPage from '../../pages/admin/ServerManagementPage';
import * as apiClient from '../../lib/apiClient';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

const mockApiFetch = vi.mocked(apiClient.apiFetch);

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ServerManagementPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const mockServerStatus = {
  environment: {
    app_env: 'staging',
    version: '1.0.0',
    canonical_validation_mode: 'strict',
  },
  feature_flags: {
    opensearch: true,
    clip: false,
    whisper: false,
    ocr: true,
    semantic_search: true,
    tus: true,
    unoserver: false,
    agent: true,
  },
  services: {
    database: { status: 'healthy', details: { connections: 5 } },
    redis: { status: 'healthy', details: {} },
    opensearch: { status: 'green', details: {} },
  },
};

describe('ServerManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('shows loader initially', () => {
      mockApiFetch.mockImplementation(() => new Promise(() => {}));

      const { container } = renderPage();

      expect(container.querySelector('.flex.items-center.justify-center')).not.toBeNull();
    });
  });

  describe('rendering', () => {
    it('renders page header', async () => {
      mockApiFetch.mockImplementation((url: string) => {
        if (url === '/admin/server-status') {
          return Promise.resolve(mockServerStatus);
        }
        return Promise.resolve({ organizations: [] });
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Server Management/i })).toBeInTheDocument();
      });
    });

    it('shows environment badge for staging', async () => {
      mockApiFetch.mockImplementation((url: string) => {
        if (url === '/admin/server-status') {
          return Promise.resolve(mockServerStatus);
        }
        return Promise.resolve({ organizations: [] });
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('staging')).toBeInTheDocument();
      });
    });

    it('does not show environment badge in production', async () => {
      mockApiFetch.mockImplementation((url: string) => {
        if (url === '/admin/server-status') {
          return Promise.resolve({
            ...mockServerStatus,
            environment: { ...mockServerStatus.environment, app_env: 'production' },
          });
        }
        return Promise.resolve({ organizations: [] });
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Server Management/i })).toBeInTheDocument();
      });
      // production is hidden via !isProduction guard
      expect(screen.queryByText('production')).not.toBeInTheDocument();
    });
  });
});
