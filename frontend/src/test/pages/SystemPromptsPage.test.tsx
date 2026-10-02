import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SystemPromptsPage from '../../pages/admin/SystemPromptsPage';
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
        <SystemPromptsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SystemPromptsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders page header', async () => {
      mockApiFetch.mockResolvedValue({ prompts: [] });

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /System Prompts/i })).toBeInTheDocument();
      });
    });

    it('renders all three persona cards', async () => {
      mockApiFetch.mockResolvedValue({ prompts: [] });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Staff \(Platform\)/i)).toBeInTheDocument();
      });
      expect(screen.getByText(/Visitor \(Public\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Guide \(Standalone\)/i)).toBeInTheDocument();
    });

    it('shows hardcoded badge when no DB entry', async () => {
      mockApiFetch.mockResolvedValue({ prompts: [] });

      renderPage();

      await waitFor(() => {
        expect(screen.getAllByText('Hardcoded').length).toBe(3);
      });
    });

    it('shows DB badge for personas with DB entries', async () => {
      mockApiFetch.mockResolvedValue({
        prompts: [
          {
            prompt_id: 'p-1',
            organization_id: null,
            persona: 'staff',
            content: 'Staff prompt content',
            version: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('DB')).toBeInTheDocument();
      });
    });

    it('renders prompt content for DB prompts', async () => {
      mockApiFetch.mockResolvedValue({
        prompts: [
          {
            prompt_id: 'p-1',
            organization_id: null,
            persona: 'staff',
            content: 'You are a staff assistant',
            version: 2,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-04-01T00:00:00Z',
          },
        ],
      });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText('You are a staff assistant')).toBeInTheDocument();
      });
    });
  });

  describe('error state', () => {
    it('shows permission error on 403', async () => {
      mockApiFetch.mockRejectedValue({ status: 403 });

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
      });
    });

    it('shows error message on API failure', async () => {
      mockApiFetch.mockRejectedValue(new Error('Network down'));

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/Network down/i)).toBeInTheDocument();
      });
    });
  });

  describe('create flow', () => {
    it('shows Save to DB button when no DB entry exists', async () => {
      mockApiFetch.mockResolvedValue({ prompts: [] });

      renderPage();

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /Save to DB/i }).length).toBe(3);
      });
    });

    it('opens create textarea when Save to DB clicked', async () => {
      mockApiFetch.mockResolvedValue({ prompts: [] });

      renderPage();

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /Save to DB/i }).length).toBe(3);
      });

      fireEvent.click(screen.getAllByRole('button', { name: /Save to DB/i })[0]);

      expect(screen.getByPlaceholderText(/Enter system prompt/i)).toBeInTheDocument();
    });

    it('disables save button when content is empty', async () => {
      mockApiFetch.mockResolvedValue({ prompts: [] });

      renderPage();

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /Save to DB/i }).length).toBe(3);
      });

      fireEvent.click(screen.getAllByRole('button', { name: /Save to DB/i })[0]);

      const saveBtn = screen.getByRole('button', { name: /Save Prompt/i });
      expect(saveBtn).toBeDisabled();
    });

    it('submits new prompt to API', async () => {
      mockApiFetch
        .mockResolvedValueOnce({ prompts: [] }) // initial load
        .mockResolvedValueOnce({}) // POST
        .mockResolvedValueOnce({ prompts: [] }); // refresh

      renderPage();

      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /Save to DB/i }).length).toBe(3);
      });

      fireEvent.click(screen.getAllByRole('button', { name: /Save to DB/i })[0]);

      fireEvent.change(screen.getByPlaceholderText(/Enter system prompt/i), {
        target: { value: 'New prompt content' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Save Prompt/i }));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/admin/system-prompts',
          expect.objectContaining({ method: 'POST' }),
        );
      });
    });
  });

  describe('edit flow', () => {
    const existingPrompt = {
      prompt_id: 'p-1',
      organization_id: null,
      persona: 'staff',
      content: 'Original content',
      version: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    it('shows Edit button for existing prompts', async () => {
      mockApiFetch.mockResolvedValue({ prompts: [existingPrompt] });

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^Edit$/i })).toBeInTheDocument();
      });
    });

    it('opens edit textarea with existing content when Edit clicked', async () => {
      mockApiFetch.mockResolvedValue({ prompts: [existingPrompt] });

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^Edit$/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /^Edit$/i }));

      const textarea = screen.getByDisplayValue('Original content');
      expect(textarea).toBeInTheDocument();
    });
  });
});
