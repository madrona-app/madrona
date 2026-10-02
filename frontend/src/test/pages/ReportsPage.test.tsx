import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ReportsPage from '../../pages/reports/ReportsPage';
import * as useOrganizationModule from '../../contexts/useOrganization';
import * as useReportsModule from '../../hooks/useReports';

// Mock the hooks
vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(),
}));

vi.mock('../../hooks/useReports', () => ({
  useReports: vi.fn(),
}));

// Mock the report components
vi.mock('../../components/reports/StatCard', () => ({
  StatCard: ({ label, value }: { label: string; value: number | string }) => (
    <div data-testid="stat-card">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  ),
}));

vi.mock('../../components/reports/RunActivityChart', () => ({
  RunActivityChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="run-activity-chart">Chart with {Array.isArray(data) ? data.length : 0} items</div>
  ),
}));

vi.mock('../../components/reports/DatasetTable', () => ({
  DatasetTable: ({ datasets }: { datasets: unknown[] }) => (
    <div data-testid="dataset-table">Table with {Array.isArray(datasets) ? datasets.length : 0} datasets</div>
  ),
}));

const mockUseOrganization = vi.mocked(useOrganizationModule.useOrganization);
const mockUseReports = vi.mocked(useReportsModule.useReports);

function renderReportsPage(orgId = 'org-123') {
  return render(
    <MemoryRouter initialEntries={[`/organizations/${orgId}/bridge/reports`]}>
      <Routes>
        <Route path="/organizations/:orgId/bridge/reports" element={<ReportsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseOrganization.mockReturnValue({
      activeOrganizationId: 'org-123',
      activeOrganization: null,
      setActiveOrganizationId: vi.fn(),
      isLoading: false,
    });
  });

  describe('no organization', () => {
    it('shows error when no organization selected', () => {
      mockUseOrganization.mockReturnValue({
        activeOrganizationId: null,
        activeOrganization: null,
        setActiveOrganizationId: vi.fn(),
        isLoading: false,
      });
      mockUseReports.mockReturnValue({
        summary: null,
        dailyRuns: [],
        datasets: [],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      // Render without route params to simulate no orgId, and activeOrganizationId is null
      render(
        <MemoryRouter>
          <ReportsPage />
        </MemoryRouter>
      );

      expect(screen.getByText('No organization selected')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading state when fetching data', () => {
      mockUseReports.mockReturnValue({
        summary: null,
        dailyRuns: [],
        datasets: [],
        isLoading: true,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      renderReportsPage();

      expect(screen.getByText('Loading dashboard metrics...')).toBeInTheDocument();
    });

    it('shows Reports heading during loading', () => {
      mockUseReports.mockReturnValue({
        summary: null,
        dailyRuns: [],
        datasets: [],
        isLoading: true,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      renderReportsPage();

      expect(screen.getByText('Reports')).toBeInTheDocument();
    });

    it('shows skeleton cards during loading', () => {
      mockUseReports.mockReturnValue({
        summary: null,
        dailyRuns: [],
        datasets: [],
        isLoading: true,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = renderReportsPage();

      const skeletons = container.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBe(4);
    });
  });

  describe('error state', () => {
    it('shows error message when fetch fails', () => {
      mockUseReports.mockReturnValue({
        summary: null,
        dailyRuns: [],
        datasets: [],
        isLoading: false,
        isError: true,
        error: new Error('Failed to fetch'),
        refetch: vi.fn(),
      });

      renderReportsPage();

      expect(screen.getByText('Failed to load reports')).toBeInTheDocument();
    });

    it('shows error details', () => {
      mockUseReports.mockReturnValue({
        summary: null,
        dailyRuns: [],
        datasets: [],
        isLoading: false,
        isError: true,
        error: new Error('Network timeout'),
        refetch: vi.fn(),
      });

      renderReportsPage();

      expect(screen.getByText('Network timeout')).toBeInTheDocument();
    });

    it('shows try again button on error', () => {
      mockUseReports.mockReturnValue({
        summary: null,
        dailyRuns: [],
        datasets: [],
        isLoading: false,
        isError: true,
        error: new Error('Failed'),
        refetch: vi.fn(),
      });

      renderReportsPage();

      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('calls refetch when try again clicked', () => {
      const mockRefetch = vi.fn();
      mockUseReports.mockReturnValue({
        summary: null,
        dailyRuns: [],
        datasets: [],
        isLoading: false,
        isError: true,
        error: new Error('Failed'),
        refetch: mockRefetch,
      });

      renderReportsPage();

      fireEvent.click(screen.getByRole('button', { name: /try again/i }));
      expect(mockRefetch).toHaveBeenCalled();
    });
  });

  describe('success state', () => {
    const mockSummary = {
      total_runs: 100,
      successful_runs: 95,
      failed_runs: 5,
      success_rate: 95,
      total_entities: 50000,
      avg_duration_ms: 1500,
      active_pipelines: 3,
      period_days: 30,
    };

    beforeEach(() => {
      mockUseReports.mockReturnValue({
        summary: mockSummary,
        dailyRuns: [{ date: '2024-01-01', runs: 10 }],
        datasets: [{ id: 'ds-1', name: 'Dataset 1' }],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('renders Reports heading', () => {
      renderReportsPage();
      expect(screen.getByText('Reports')).toBeInTheDocument();
    });

    it('renders period days in description', () => {
      renderReportsPage();
      expect(screen.getByText(/last 30 days/)).toBeInTheDocument();
    });

    it('renders refresh button', () => {
      renderReportsPage();
      expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    });

    it('calls refetch when refresh clicked', () => {
      const mockRefetch = vi.fn();
      mockUseReports.mockReturnValue({
        summary: mockSummary,
        dailyRuns: [],
        datasets: [],
        isLoading: false,
        isError: false,
        error: null,
        refetch: mockRefetch,
      });

      renderReportsPage();

      fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
      expect(mockRefetch).toHaveBeenCalled();
    });

    it('renders stat cards', () => {
      renderReportsPage();
      const statCards = screen.getAllByTestId('stat-card');
      expect(statCards.length).toBe(4);
    });

    it('renders run activity chart', () => {
      renderReportsPage();
      expect(screen.getByTestId('run-activity-chart')).toBeInTheDocument();
    });

    it('renders dataset table', () => {
      renderReportsPage();
      expect(screen.getByTestId('dataset-table')).toBeInTheDocument();
    });

    it('passes data to chart', () => {
      renderReportsPage();
      expect(screen.getByText('Chart with 1 items')).toBeInTheDocument();
    });

    it('passes data to table', () => {
      renderReportsPage();
      expect(screen.getByText('Table with 1 datasets')).toBeInTheDocument();
    });
  });

  describe('fallback values', () => {
    it('uses fallback when summary is null', () => {
      mockUseReports.mockReturnValue({
        summary: null,
        dailyRuns: [],
        datasets: [],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      renderReportsPage();

      // Should still render with 0 values
      expect(screen.getByText(/last 30 days/)).toBeInTheDocument();
    });
  });
});
