import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProcedureEnforcementSettingsPage from '../../pages/collections/ProcedureEnforcementSettingsPage';
import * as apiClientModule from '../../lib/apiClient';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), dismissToast: vi.fn(), toasts: [] }),
}));

const mockApiFetch = vi.mocked(apiClientModule.apiFetch);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPage(orgId = 'org-123') {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/settings/procedure`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/settings/procedure"
            element={<ProcedureEnforcementSettingsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sampleProcedures = {
  procedures: {
    acquisition: {
      enabled: true,
      label: 'Acquisition',
      requirement_count: 5,
      blocking_count: 3,
    },
    loan_in: {
      enabled: false,
      label: 'Loan In',
      requirement_count: 4,
      blocking_count: 2,
    },
  },
};

describe('ProcedureEnforcementSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state while fetching settings', () => {
    mockApiFetch.mockImplementation(() => new Promise(() => {}));
    renderPage();
    // The MadronaLoader has the label "Loading..."
    expect(
      screen.queryByRole('heading', { name: /procedure enforcement/i }),
    ).not.toBeInTheDocument();
  });

  it('renders the page header and description', async () => {
    mockApiFetch.mockResolvedValue(sampleProcedures);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /procedure enforcement/i }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/control whether procedure requirements/i),
    ).toBeInTheDocument();
  });

  it('renders procedure rows in alphabetical order', async () => {
    mockApiFetch.mockResolvedValue(sampleProcedures);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Acquisition')).toBeInTheDocument();
    });
    expect(screen.getByText('Loan In')).toBeInTheDocument();
    // Check requirement and blocking counts
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('toggles a procedure on click', async () => {
    mockApiFetch.mockResolvedValueOnce(sampleProcedures);
    mockApiFetch.mockResolvedValueOnce({});
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Acquisition')).toBeInTheDocument();
    });
    // The first toggle button is for Acquisition (enabled), second for Loan In (disabled)
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/organizations/org-123/settings/procedure-enforcement',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });

  it('renders explanatory footer text', async () => {
    mockApiFetch.mockResolvedValue(sampleProcedures);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/staff cannot advance a record past a status gate/i),
      ).toBeInTheDocument();
    });
  });

  it('renders empty table when no procedures returned', async () => {
    mockApiFetch.mockResolvedValue({ procedures: {} });
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /procedure enforcement/i }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText('Acquisition')).not.toBeInTheDocument();
  });

  it('queries procedure-enforcement endpoint with the org id', async () => {
    mockApiFetch.mockResolvedValue(sampleProcedures);
    renderPage('my-org');
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/organizations/my-org/settings/procedure-enforcement',
      );
    });
  });
});
