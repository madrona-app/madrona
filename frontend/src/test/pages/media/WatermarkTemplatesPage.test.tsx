import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WatermarkTemplatesPage from '../../../pages/media/WatermarkTemplatesPage';
import * as api from '../../../lib/api';

vi.mock('../../../lib/api', () => ({
  getWatermarkTemplates: vi.fn(),
  deleteWatermarkTemplate: vi.fn(),
}));

vi.mock('../../../components/dam', () => ({
  WatermarkTemplateModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Watermark Template Modal">
      <button onClick={onClose}>Cancel</button>
    </div>
  ),
}));

const mockGetWatermarkTemplates = vi.mocked(api.getWatermarkTemplates);
const mockDeleteWatermarkTemplate = vi.mocked(api.deleteWatermarkTemplate);

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPage(orgId = 'org-123') {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/media/config/watermarks`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/media/config/watermarks"
            element={<WatermarkTemplatesPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('WatermarkTemplatesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading skeleton initially', () => {
    mockGetWatermarkTemplates.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(
      screen.queryByRole('heading', { name: /watermark templates/i })
    ).not.toBeInTheDocument();
  });

  it('shows error state on API failure', async () => {
    mockGetWatermarkTemplates.mockRejectedValue(new Error('Forbidden'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error loading watermark templates/i)).toBeInTheDocument();
      expect(screen.getByText(/forbidden/i)).toBeInTheDocument();
    });
  });

  it('renders empty state with CTA when no templates exist', async () => {
    mockGetWatermarkTemplates.mockResolvedValue({ templates: [] } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no watermark templates/i)).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: /create first template/i })
    ).toBeInTheDocument();
  });

  it('opens modal when "New Template" clicked', async () => {
    mockGetWatermarkTemplates.mockResolvedValue({ templates: [] } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no watermark templates/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /new template/i }));
    expect(screen.getByRole('dialog', { name: /watermark template modal/i })).toBeInTheDocument();
  });

  it('renders template cards with config previews', async () => {
    mockGetWatermarkTemplates.mockResolvedValue({
      templates: [
        {
          template_id: 't-1',
          name: 'Corporate Text',
          watermark_type: 'text',
          is_default: true,
          config: { text: '© Museum', position: 'bottom-right', opacity: 0.5 },
        },
        {
          template_id: 't-2',
          name: 'Logo Image',
          watermark_type: 'image',
          is_default: false,
          config: { position: 'top-left', opacity: 0.8 },
        },
      ],
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Corporate Text')).toBeInTheDocument();
    });
    expect(screen.getByText('Logo Image')).toBeInTheDocument();
    expect(screen.getByText(/Text: "© Museum"/)).toBeInTheDocument();
    expect(screen.getByText(/Position: bottom right/i)).toBeInTheDocument();
    expect(screen.getByText(/opacity: 50%/i)).toBeInTheDocument();
    expect(screen.getByText(/opacity: 80%/i)).toBeInTheDocument();
  });

  it('opens delete confirmation dialog', async () => {
    mockGetWatermarkTemplates.mockResolvedValue({
      templates: [
        {
          template_id: 't-1',
          name: 'My Watermark',
          watermark_type: 'text',
          is_default: false,
          config: { text: 'foo', position: 'center', opacity: 0.5 },
        },
      ],
    } as any);
    mockDeleteWatermarkTemplate.mockResolvedValue({} as any);

    const { container } = renderPage();
    await waitFor(() => expect(screen.getByText('My Watermark')).toBeInTheDocument());

    // The kebab menu is the only button with MoreHorizontal — find by role and structure
    // There is a button after the template card's header area; simulate clicks in order
    const cardButtons = container.querySelectorAll('.card button');
    // First card button is the kebab menu trigger
    fireEvent.click(cardButtons[0]);

    // Delete menu item now visible
    const deleteBtn = await screen.findByRole('button', { name: /delete/i });
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(screen.getByText(/delete watermark template/i)).toBeInTheDocument();
      expect(screen.getByText(/are you sure you want to delete "my watermark"/i)).toBeInTheDocument();
    });
  });

});
