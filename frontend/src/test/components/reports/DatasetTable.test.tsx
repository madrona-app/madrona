import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DatasetTable } from '../../../components/reports/DatasetTable';
import type { DatasetSummary } from '../../../lib/api';

// Wrap component with MemoryRouter for Link components
function renderWithRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('DatasetTable', () => {
  const mockDatasets: DatasetSummary[] = [
    {
      dataset_id: 'ds-1',
      name: 'Test Dataset 1',
      entity_count: 1000,
      runs_total: 50,
      runs_successful: 48,
      runs_failed: 2,
      success_rate: 96,
      last_run_at: new Date().toISOString(),
    },
    {
      dataset_id: 'ds-2',
      name: 'Test Dataset 2',
      entity_count: 500,
      runs_total: 20,
      runs_successful: 14,
      runs_failed: 6,
      success_rate: 70,
      last_run_at: null,
    },
    {
      dataset_id: 'ds-3',
      name: 'Test Dataset 3',
      entity_count: 2500,
      runs_total: 10,
      runs_successful: 5,
      runs_failed: 5,
      success_rate: 50,
      last_run_at: new Date(Date.now() - 86400000 * 3).toISOString(), // 3 days ago
    },
  ];

  describe('empty state', () => {
    it('renders empty state when no datasets', () => {
      renderWithRouter(<DatasetTable datasets={[]} organizationId="org-123" />);

      expect(screen.getByText('No datasets found')).toBeInTheDocument();
    });

    it('shows Dataset Summary title in empty state', () => {
      renderWithRouter(<DatasetTable datasets={[]} organizationId="org-123" />);

      expect(screen.getByText('Dataset Summary')).toBeInTheDocument();
    });
  });

  describe('table rendering', () => {
    it('renders table with datasets', () => {
      renderWithRouter(<DatasetTable datasets={mockDatasets} organizationId="org-123" />);

      expect(screen.getByText('Test Dataset 1')).toBeInTheDocument();
      expect(screen.getByText('Test Dataset 2')).toBeInTheDocument();
      expect(screen.getByText('Test Dataset 3')).toBeInTheDocument();
    });

    it('shows Dataset Summary header', () => {
      renderWithRouter(<DatasetTable datasets={mockDatasets} organizationId="org-123" />);

      expect(screen.getByText('Dataset Summary')).toBeInTheDocument();
    });

    it('renders column headers', () => {
      renderWithRouter(<DatasetTable datasets={mockDatasets} organizationId="org-123" />);

      expect(screen.getByText('Dataset')).toBeInTheDocument();
      expect(screen.getByText('Entities')).toBeInTheDocument();
      expect(screen.getByText('Last Sync')).toBeInTheDocument();
      expect(screen.getByText('Runs')).toBeInTheDocument();
      expect(screen.getByText('Success Rate')).toBeInTheDocument();
    });
  });

  describe('entity counts', () => {
    it('displays formatted entity counts', () => {
      renderWithRouter(<DatasetTable datasets={mockDatasets} organizationId="org-123" />);

      expect(screen.getByText('1,000')).toBeInTheDocument();
      expect(screen.getByText('500')).toBeInTheDocument();
      expect(screen.getByText('2,500')).toBeInTheDocument();
    });
  });

  describe('run counts', () => {
    it('displays run totals', () => {
      renderWithRouter(<DatasetTable datasets={mockDatasets} organizationId="org-123" />);

      expect(screen.getByText('50')).toBeInTheDocument();
      expect(screen.getByText('20')).toBeInTheDocument();
      expect(screen.getByText('10')).toBeInTheDocument();
    });
  });

  describe('success rates', () => {
    it('displays success rate percentages', () => {
      renderWithRouter(<DatasetTable datasets={mockDatasets} organizationId="org-123" />);

      expect(screen.getByText('96%')).toBeInTheDocument();
      expect(screen.getByText('70%')).toBeInTheDocument();
      expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('displays N/A for null success rate', () => {
      const datasetsWithNull: DatasetSummary[] = [
        {
          dataset_id: 'ds-null',
          name: 'Null Rate Dataset',
          entity_count: 100,
          runs_total: 0,
          runs_successful: 0,
          runs_failed: 0,
          success_rate: null as any, // Type coerce for test
          last_run_at: null,
        },
      ];

      renderWithRouter(<DatasetTable datasets={datasetsWithNull} organizationId="org-123" />);

      expect(screen.getByText('N/A')).toBeInTheDocument();
    });
  });

  describe('last sync time', () => {
    it('displays "Never" when last_run_at is null', () => {
      renderWithRouter(<DatasetTable datasets={mockDatasets} organizationId="org-123" />);

      expect(screen.getByText('Never')).toBeInTheDocument();
    });

    it('displays relative time for recent sync (minutes)', () => {
      const recentDataset: DatasetSummary[] = [
        {
          dataset_id: 'ds-recent',
          name: 'Recent Dataset',
          entity_count: 100,
          runs_total: 1,
          runs_successful: 1,
          runs_failed: 0,
          success_rate: 100,
          last_run_at: new Date(Date.now() - 5 * 60000).toISOString(), // 5 minutes ago
        },
      ];

      renderWithRouter(<DatasetTable datasets={recentDataset} organizationId="org-123" />);

      expect(screen.getByText('5 minutes ago')).toBeInTheDocument();
    });

    it('displays relative time for sync a few hours ago', () => {
      const hoursAgoDataset: DatasetSummary[] = [
        {
          dataset_id: 'ds-hours',
          name: 'Hours Dataset',
          entity_count: 100,
          runs_total: 1,
          runs_successful: 1,
          runs_failed: 0,
          success_rate: 100,
          last_run_at: new Date(Date.now() - 3600000 * 5).toISOString(), // 5 hours ago
        },
      ];

      renderWithRouter(<DatasetTable datasets={hoursAgoDataset} organizationId="org-123" />);

      expect(screen.getByText('5 hours ago')).toBeInTheDocument();
    });

    it('displays formatted date for sync older than 7 days', () => {
      const oldDataset: DatasetSummary[] = [
        {
          dataset_id: 'ds-old',
          name: 'Old Dataset',
          entity_count: 100,
          runs_total: 1,
          runs_successful: 1,
          runs_failed: 0,
          success_rate: 100,
          last_run_at: new Date(Date.now() - 86400000 * 10).toISOString(), // 10 days ago
        },
      ];

      renderWithRouter(<DatasetTable datasets={oldDataset} organizationId="org-123" />);

      // Should show formatted date like "Jan 9" instead of "10d ago"
      // The exact value depends on current date
      const lastSyncCell = screen.getByText('Old Dataset')
        .closest('tr')
        ?.querySelector('td:nth-child(3)');
      expect(lastSyncCell).toBeInTheDocument();
      // The format should be "Mon DD" (e.g., "Jan 9")
      expect(lastSyncCell?.textContent).toMatch(/[A-Z][a-z]{2} \d{1,2}/);
    });
  });

  describe('links', () => {
    it('links to dataset detail page', () => {
      renderWithRouter(<DatasetTable datasets={mockDatasets} organizationId="org-123" />);

      const link = screen.getByRole('link', { name: /Test Dataset 1/i });
      expect(link).toHaveAttribute('href', '/organizations/org-123/bridge/datasets/ds-1');
    });

    it('uses correct organization ID in links', () => {
      renderWithRouter(<DatasetTable datasets={mockDatasets} organizationId="different-org" />);

      const link = screen.getByRole('link', { name: /Test Dataset 1/i });
      expect(link).toHaveAttribute('href', '/organizations/different-org/bridge/datasets/ds-1');
    });
  });
});
