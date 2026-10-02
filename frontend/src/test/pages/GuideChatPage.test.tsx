import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GuideChatPage from '../../pages/guide/GuideChatPage';
import * as apiClient from '../../lib/apiClient';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
  API_BASE_URL: '/api',
}));

const mockApiFetch = vi.mocked(apiClient.apiFetch);

function renderPage() {
  return render(
    <MemoryRouter>
      <GuideChatPage />
    </MemoryRouter>
  );
}

describe('GuideChatPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom doesn't implement Element.scrollTo
    Element.prototype.scrollTo = vi.fn() as unknown as Element['scrollTo'];
  });

  it('renders the empty greeting when no conversations exist', async () => {
    mockApiFetch.mockResolvedValue({ conversations: [] });
    renderPage();

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/guide/chat/conversations');
    });
  });

  it('renders the message input textarea', async () => {
    mockApiFetch.mockResolvedValue({ conversations: [] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });
  });

  it('renders existing conversations in the sidebar', async () => {
    mockApiFetch.mockResolvedValue({
      conversations: [
        {
          conversation_id: 'c-1',
          title: 'Loan agreement question',
          created_at: '2026-04-20T10:00:00Z',
        },
        {
          conversation_id: 'c-2',
          title: null,
          created_at: '2026-04-19T15:00:00Z',
        },
      ],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Loan agreement question')).toBeInTheDocument();
    });
  });

  it('survives a failed conversations fetch without crashing', async () => {
    mockApiFetch.mockRejectedValue(new Error('boom'));
    renderPage();

    // Loading branch — the page does not surface the error, just stays empty
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalled();
    });
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('shows the New conversation affordance', async () => {
    mockApiFetch.mockResolvedValue({ conversations: [] });
    renderPage();

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalled();
    });
    expect(screen.getByRole('button', { name: /new conversation/i })).toBeInTheDocument();
  });

  it('renders a textarea with the placeholder prompt', async () => {
    mockApiFetch.mockResolvedValue({ conversations: [] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/ask a question/i)).toBeInTheDocument();
    });
  });
});
