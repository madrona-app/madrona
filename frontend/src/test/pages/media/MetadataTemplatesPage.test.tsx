import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MetadataTemplatesPage from '../../../pages/media/MetadataTemplatesPage';
import * as api from '../../../lib/api';

vi.mock('../../../lib/api', () => ({
  getMetadataTemplates: vi.fn(),
  deleteMetadataTemplate: vi.fn(),
  setDefaultMetadataTemplate: vi.fn(),
}));

vi.mock('../../../components/dam', () => ({
  MetadataTemplateModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Metadata Template Modal">
      <button onClick={onClose}>Cancel</button>
    </div>
  ),
}));

const mockGetMetadataTemplates = vi.mocked(api.getMetadataTemplates);
const mockDeleteMetadataTemplate = vi.mocked(api.deleteMetadataTemplate);
const mockSetDefaultMetadataTemplate = vi.mocked(api.setDefaultMetadataTemplate);

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
      <MemoryRouter initialEntries={[`/organizations/${orgId}/media/metadata-templates`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/media/metadata-templates"
            element={<MetadataTemplatesPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const baseTemplate = {
  template_id: 't-1',
  name: 'Standard Photo',
  description: 'Default photo metadata',
  is_default: false,
  template_fields: {
    creator: 'Museum Staff',
    copyright_status: 'in_copyright',
    tags: ['photo', 'archival'],
  },
};

describe('MetadataTemplatesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading skeleton initially', () => {
    mockGetMetadataTemplates.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(
      screen.queryByRole('heading', { name: /metadata templates/i })
    ).not.toBeInTheDocument();
  });

  it('shows error state on API failure', async () => {
    mockGetMetadataTemplates.mockRejectedValue(new Error('Forbidden'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/error loading metadata templates/i)).toBeInTheDocument();
      expect(screen.getByText(/forbidden/i)).toBeInTheDocument();
    });
  });

  it('shows empty state with CTA when no templates', async () => {
    mockGetMetadataTemplates.mockResolvedValue({ templates: [] } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no metadata templates/i)).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: /create first template/i })
    ).toBeInTheDocument();
  });

  it('opens modal when "New Template" clicked', async () => {
    mockGetMetadataTemplates.mockResolvedValue({ templates: [] } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no metadata templates/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /new template/i }));
    expect(
      screen.getByRole('dialog', { name: /metadata template modal/i })
    ).toBeInTheDocument();
  });

  it('renders template cards with details', async () => {
    mockGetMetadataTemplates.mockResolvedValue({
      templates: [
        baseTemplate,
        {
          ...baseTemplate,
          template_id: 't-2',
          name: 'Default Template',
          is_default: true,
          template_fields: { creator: 'Staff' },
        },
      ],
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Standard Photo')).toBeInTheDocument();
    });
    expect(screen.getByText('Default Template')).toBeInTheDocument();
    expect(screen.getByText(/creator: museum staff/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/default template/i)).toBeInTheDocument();
  });

  it('filters templates by search query', async () => {
    mockGetMetadataTemplates.mockResolvedValue({
      templates: [
        baseTemplate,
        {
          ...baseTemplate,
          template_id: 't-2',
          name: 'Press Kit',
          description: 'For press releases',
        },
      ],
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Standard Photo')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText(/search templates/i), {
      target: { value: 'press' },
    });
    expect(screen.queryByText('Standard Photo')).not.toBeInTheDocument();
    expect(screen.getByText('Press Kit')).toBeInTheDocument();
  });

  it('shows no-results state when search has no matches', async () => {
    mockGetMetadataTemplates.mockResolvedValue({
      templates: [baseTemplate],
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Standard Photo')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText(/search templates/i), {
      target: { value: 'nothing-matches' },
    });
    expect(screen.getByText(/no templates match/i)).toBeInTheDocument();
  });

  it('opens delete confirmation via context menu', async () => {
    mockGetMetadataTemplates.mockResolvedValue({
      templates: [baseTemplate],
    } as any);
    mockDeleteMetadataTemplate.mockResolvedValue({} as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Standard Photo')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText(/template options/i));
    fireEvent.click(await screen.findByRole('button', { name: /^delete$/i }));
    await waitFor(() => {
      expect(screen.getByText(/delete metadata template/i)).toBeInTheDocument();
      expect(
        screen.getByText(/are you sure you want to delete "standard photo"/i)
      ).toBeInTheDocument();
    });
  });

  it('sets a template as default via context menu', async () => {
    mockGetMetadataTemplates.mockResolvedValue({
      templates: [baseTemplate],
    } as any);
    mockSetDefaultMetadataTemplate.mockResolvedValue({} as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Standard Photo')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText(/template options/i));
    fireEvent.click(await screen.findByRole('button', { name: /set as default/i }));
    await waitFor(() => {
      expect(mockSetDefaultMetadataTemplate).toHaveBeenCalledWith('org-123', 't-1');
    });
  });

  it('renders the about section', async () => {
    mockGetMetadataTemplates.mockResolvedValue({
      templates: [baseTemplate],
    } as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/about metadata templates/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/bulk application/i)).toBeInTheDocument();
    expect(screen.getByText(/rights & attribution/i)).toBeInTheDocument();
  });
});
