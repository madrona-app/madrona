import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MediaFieldInheritanceSettingsPage from '../../../pages/media/MediaFieldInheritanceSettingsPage';
import * as api from '../../../lib/api';

vi.mock('../../../lib/api', () => ({
  listFieldInheritanceConfig: vi.fn(),
  createFieldInheritanceConfig: vi.fn(),
  updateFieldInheritanceConfig: vi.fn(),
  deleteFieldInheritanceConfig: vi.fn(),
  seedFieldInheritanceConfig: vi.fn(),
}));

const mockList = vi.mocked(api.listFieldInheritanceConfig);
const mockSeed = vi.mocked(api.seedFieldInheritanceConfig);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(orgId: string | undefined = 'org-123') {
  const qc = createQueryClient();
  if (!orgId) {
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/no-org']}>
          <Routes>
            <Route path="/no-org" element={<MediaFieldInheritanceSettingsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={[`/organizations/${orgId}/media/field-inheritance`]}
      >
        <Routes>
          <Route
            path="/organizations/:orgId/media/field-inheritance"
            element={<MediaFieldInheritanceSettingsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sampleConfigs = {
  configs: [
    {
      config_id: 'fc-1',
      source_field: 'object_number',
      display_label: 'Object Number',
      display_context: 'both',
      transform_type: null,
      transform_config: null,
      sort_order: 0,
      is_active: true,
    },
    {
      config_id: 'fc-2',
      source_field: 'titles',
      display_label: 'Titles',
      display_context: 'detail',
      transform_type: 'array_first',
      transform_config: null,
      sort_order: 1,
      is_active: false,
    },
  ],
};

describe('MediaFieldInheritanceSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the heading and description', async () => {
    mockList.mockResolvedValue(sampleConfigs as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getAllByRole('heading', { name: /field inheritance/i }).length,
      ).toBeGreaterThan(0);
    });
    expect(
      screen.getByText(/configure which collection object fields/i),
    ).toBeInTheDocument();
  });

  it('renders the help text panel', async () => {
    mockList.mockResolvedValue(sampleConfigs as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/how field inheritance works/i),
      ).toBeInTheDocument();
    });
  });

  it('renders configured field rows', async () => {
    mockList.mockResolvedValue(sampleConfigs as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Object Number')).toBeInTheDocument();
    });
    expect(screen.getByText('Titles')).toBeInTheDocument();
  });

  it('shows error state when load fails', async () => {
    mockList.mockRejectedValue(new Error('boom'));
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/failed to load configuration/i),
      ).toBeInTheDocument();
    });
  });

  it('shows seed defaults button when no configs', async () => {
    mockList.mockResolvedValue({ configs: [] } as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /add defaults/i }),
      ).toBeInTheDocument();
    });
  });

  it('opens add field row when clicking Add Field', async () => {
    mockList.mockResolvedValue(sampleConfigs as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /add field/i }),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /add field/i }));
    await waitFor(() => {
      expect(screen.getByText(/source field/i)).toBeInTheDocument();
    });
  });

  it('shows the Add Field button', async () => {
    mockList.mockResolvedValue(sampleConfigs as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /add field/i }),
      ).toBeInTheDocument();
    });
  });

  it('triggers seed defaults flow when clicked', async () => {
    mockList.mockResolvedValue({ configs: [] } as any);
    mockSeed.mockResolvedValue({} as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /add defaults/i }),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /add defaults/i }));
    // Confirm dialog should appear
    await waitFor(() => {
      expect(screen.getByText(/add default mappings/i)).toBeInTheDocument();
    });
  });
});
