import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import APIKeysPage from '../../pages/admin/APIKeysPage';
import * as apiClient from '../../lib/apiClient';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

const mockApiFetch = vi.mocked(apiClient.apiFetch);

function renderPage(orgId = 'org-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/admin/api-keys`]}>
        <Routes>
          <Route path="/organizations/:orgId/admin/api-keys" element={<APIKeysPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('APIKeysPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders page header', async () => {
      mockApiFetch.mockResolvedValue({ api_keys: [] });

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /API Keys/i })).toBeInTheDocument();
      });
    });

    it('renders description', async () => {
      mockApiFetch.mockResolvedValue({ api_keys: [] });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Manage API access for third-party/i)).toBeInTheDocument();
      });
    });
  });

  describe('empty state', () => {
    it('shows no keys message', async () => {
      mockApiFetch.mockResolvedValue({ api_keys: [] });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/No API keys yet/i)).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /Create your first key/i })).toBeInTheDocument();
    });
  });

  describe('with data', () => {
    const keys = [
      {
        api_key_id: 'k-1',
        name: 'Test Key',
        key_prefix: 'mk_test',
        scopes: ['collections.view', 'media.view'],
        status: 'active',
        created_at: '2026-01-01T00:00:00Z',
        expires_at: null,
        last_used_at: null,
      },
    ];

    it('renders key list', async () => {
      mockApiFetch.mockResolvedValue({ api_keys: keys });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Test Key')).toBeInTheDocument();
      });
    });

    it('shows key prefix', async () => {
      mockApiFetch.mockResolvedValue({ api_keys: keys });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/mk_test/)).toBeInTheDocument();
      });
    });

    it('renders scope badges', async () => {
      mockApiFetch.mockResolvedValue({ api_keys: keys });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('collections.view')).toBeInTheDocument();
      });
      expect(screen.getByText('media.view')).toBeInTheDocument();
    });

    it('shows active key count', async () => {
      mockApiFetch.mockResolvedValue({ api_keys: keys });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/1 active key/i)).toBeInTheDocument();
      });
    });
  });

  describe('create flow', () => {
    beforeEach(() => {
      mockApiFetch.mockResolvedValue({ api_keys: [] });
    });

    it('opens create form when Create Key clicked', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/No API keys yet/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Create your first key/i }));

      expect(screen.getByText('Create New API Key')).toBeInTheDocument();
      expect(screen.getByLabelText(/Key Name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Expiration/i)).toBeInTheDocument();
    });

    it('disables create button when name is empty', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/No API keys yet/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Create your first key/i }));

      const createBtn = screen.getByRole('button', { name: /^Create Key$/i });
      expect(createBtn).toBeDisabled();
    });

    it('enables create button after entering a name', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/No API keys yet/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Create your first key/i }));

      fireEvent.change(screen.getByLabelText(/Key Name/i), {
        target: { value: 'My Key' },
      });

      const createBtn = screen.getByRole('button', { name: /^Create Key$/i });
      expect(createBtn).not.toBeDisabled();
    });

    it('cancels back to list view', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/No API keys yet/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Create your first key/i }));

      expect(screen.getByText('Create New API Key')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

      expect(screen.queryByText('Create New API Key')).not.toBeInTheDocument();
    });
  });

  describe('error states', () => {
    it('shows permission error on 403', async () => {
      mockApiFetch.mockRejectedValue({ status: 403 });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
      });
    });

    it('shows generic error on failure', async () => {
      mockApiFetch.mockRejectedValue(new Error('Server error'));

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Server error/i)).toBeInTheDocument();
      });
    });
  });
});
