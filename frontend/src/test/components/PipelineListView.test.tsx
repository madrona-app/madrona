import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PipelineListView } from '../../components/PipelineListView';
import { checkA11y, formatViolations } from '../a11y';
import type { Pipeline, ConnectorInstance, Dataset, Run } from '../../lib/schemas';

// Mock data
const mockPipelines: Pipeline[] = [
  {
    pipeline_id: 'pipe-1',
    name: 'Test Pipeline',
    organization_id: 'org-1',
    dataset_id: 'ds-1',
    sources: [{ connector_instance_id: 'conn-1' }],
    destinations: [{ connector_instance_id: 'conn-2' }],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
];

const mockConnectors: ConnectorInstance[] = [
  {
    connector_instance_id: 'conn-1',
    name: 'Source Connector',
    connector_definition_id: 'def-1',
    organization_id: 'org-1',
    direction: 'source',
    config: {},
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    connector_instance_id: 'conn-2',
    name: 'Destination Connector',
    connector_definition_id: 'def-2',
    organization_id: 'org-1',
    direction: 'destination',
    config: {},
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
];

const mockDatasets: Dataset[] = [
  {
    dataset_id: 'ds-1',
    name: 'Test Dataset',
    organization_id: 'org-1',
    entity_count: 100,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
];

const mockRun: Run = {
  run_id: 'run-1',
  pipeline_id: 'pipe-1',
  organization_id: 'org-1',
  status: 'success',
  started_at: '2024-01-01T00:00:00Z',
  finished_at: '2024-01-01T00:01:00Z',
};

const defaultProps = {
  pipelines: mockPipelines,
  connectors: mockConnectors,
  datasets: mockDatasets,
  runsByPipeline: new Map<string, Run>([['pipe-1', mockRun]]),
  activeRunsByPipeline: new Map<string, boolean>([['pipe-1', false]]),
  onSourceClick: () => {},
  onDestinationClick: () => {},
  onDatasetClick: () => {},
};

describe('PipelineListView', () => {
  describe('rendering', () => {
    it('renders pipeline with dataset name', () => {
      render(<PipelineListView {...defaultProps} />);
      expect(screen.getByText('Test Dataset')).toBeInTheDocument();
    });

    it('renders empty state when no pipelines', () => {
      render(<PipelineListView {...defaultProps} pipelines={[]} />);
      expect(screen.getByText('No pipelines configured')).toBeInTheDocument();
    });

    it('shows source and destination counts', () => {
      render(<PipelineListView {...defaultProps} />);
      expect(screen.getByText('1 source')).toBeInTheDocument();
      expect(screen.getByText('1 dest')).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('expands pipeline on click', async () => {
      const user = userEvent.setup();
      render(<PipelineListView {...defaultProps} />);

      const expandButton = screen.getByRole('button', { expanded: false });
      await user.click(expandButton);

      expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
      expect(screen.getByText('Source Connector')).toBeInTheDocument();
    });

    it('calls onDatasetClick when dataset is clicked', async () => {
      const user = userEvent.setup();
      const onDatasetClick = vi.fn();
      render(<PipelineListView {...defaultProps} onDatasetClick={onDatasetClick} />);

      // Expand first
      await user.click(screen.getByRole('button', { expanded: false }));

      // Click dataset button (the one showing entity count)
      await user.click(screen.getByText('100 entities').closest('button')!);
      expect(onDatasetClick).toHaveBeenCalledWith('ds-1');
    });
  });

  describe('status indicators', () => {
    it('shows success status with screen reader text', () => {
      render(<PipelineListView {...defaultProps} />);
      expect(screen.getByText('Success')).toBeInTheDocument();
    });

    it('shows running status when active', () => {
      const activeProps = {
        ...defaultProps,
        activeRunsByPipeline: new Map([['pipe-1', true]]),
      };
      render(<PipelineListView {...activeProps} />);
      expect(screen.getByText('Running')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has no accessibility violations', async () => {
      const { container } = render(<PipelineListView {...defaultProps} />);
      const results = await checkA11y(container);

      if (results.violations.length > 0) {
        console.log(formatViolations(results));
      }

      expect(results).toHaveNoViolations();
    });

    it('has no violations in empty state', async () => {
      const { container } = render(
        <PipelineListView {...defaultProps} pipelines={[]} />
      );
      const results = await checkA11y(container);
      expect(results).toHaveNoViolations();
    });

    it('has no violations when expanded', async () => {
      const user = userEvent.setup();
      const { container } = render(<PipelineListView {...defaultProps} />);

      await user.click(screen.getByRole('button', { expanded: false }));

      const results = await checkA11y(container);
      expect(results).toHaveNoViolations();
    });

    it('has proper aria-expanded attributes', async () => {
      const user = userEvent.setup();
      render(<PipelineListView {...defaultProps} />);

      const button = screen.getByRole('button', { expanded: false });
      expect(button).toHaveAttribute('aria-expanded', 'false');

      await user.click(button);
      expect(button).toHaveAttribute('aria-expanded', 'true');
    });
  });
});
