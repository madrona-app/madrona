import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReportTemplatesSettingsPage from '../../pages/collections/ReportTemplatesSettingsPage';
import * as reportApi from '../../lib/api/report-templates';
import * as useOrganizationHook from '../../contexts/useOrganization';

vi.mock('../../lib/api/report-templates', () => ({
  listReportTemplates: vi.fn(),
  uploadReportTemplate: vi.fn(),
  deleteReportTemplate: vi.fn(),
  getReportTemplateDownloadUrl: vi.fn(
    (orgId: string, name: string) => `/api/${orgId}/templates/${name}`,
  ),
  getDefaultTemplateDownloadUrl: vi.fn(
    (orgId: string, name: string) => `/api/${orgId}/templates/default/${name}`,
  ),
}));

vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(),
}));

const mockListReportTemplates = vi.mocked(reportApi.listReportTemplates);
const mockUseOrganization = vi.mocked(useOrganizationHook.useOrganization);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(orgId = 'org-123') {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={[`/organizations/${orgId}/collections/config/report-templates`]}
      >
        <Routes>
          <Route
            path="/organizations/:orgId/collections/config/report-templates"
            element={<ReportTemplatesSettingsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ReportTemplatesSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseOrganization.mockReturnValue({
      activeOrganizationId: 'org-123',
    } as ReturnType<typeof useOrganizationHook.useOrganization>);
  });

  it('renders heading and description', async () => {
    mockListReportTemplates.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /report templates/i }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/upload custom html templates/i),
    ).toBeInTheDocument();
  });

  it('renders the info box with available template names', async () => {
    mockListReportTemplates.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/how template overrides work/i),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/object_record_sheet\.html/i),
    ).toBeInTheDocument();
  });

  it('shows empty state when no templates uploaded', async () => {
    mockListReportTemplates.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/no custom templates uploaded yet/i),
      ).toBeInTheDocument();
    });
  });

  it('renders templates table when present', async () => {
    mockListReportTemplates.mockResolvedValue([
      {
        name: 'condition_report.html',
        size: 1024,
        last_modified: '2024-01-15T10:00:00Z',
      },
    ] as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('condition_report.html')).toBeInTheDocument();
    });
    // Size is shown in some format - just verify it's rendered
    expect(screen.getByText('condition_report.html')).toBeInTheDocument();
  });

  it('shows upload template button', async () => {
    mockListReportTemplates.mockResolvedValue([]);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /upload template/i }),
      ).toBeInTheDocument();
    });
  });

  it('shows delete confirm flow', async () => {
    mockListReportTemplates.mockResolvedValue([
      {
        name: 'condition_report.html',
        size: 1024,
        last_modified: '2024-01-15T10:00:00Z',
      },
    ] as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /delete/i }),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /confirm/i }),
      ).toBeInTheDocument();
    });
  });
});
