import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunActivityChart } from '../../../components/reports/RunActivityChart';
import type { DailyRunStats } from '../../../lib/api';

// Mock recharts to avoid rendering issues in tests
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({ data, children }: { data: any[]; children: React.ReactNode }) => (
    <div data-testid="bar-chart" data-length={data.length}>
      {children}
    </div>
  ),
  Bar: ({ dataKey }: { dataKey: string }) => <div data-testid={`bar-${dataKey}`} />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
}));

describe('RunActivityChart', () => {
  const mockData: DailyRunStats[] = [
    { date: '2024-01-15', success: 10, failed: 2 },
    { date: '2024-01-14', success: 8, failed: 1 },
    { date: '2024-01-13', success: 12, failed: 0 },
    { date: '2024-01-12', success: 5, failed: 3 },
    { date: '2024-01-11', success: 15, failed: 1 },
  ];

  describe('empty state', () => {
    it('renders empty state when no data', () => {
      render(<RunActivityChart data={[]} />);

      expect(screen.getByText('No run data available for this period')).toBeInTheDocument();
    });

    it('shows Run Activity title in empty state', () => {
      render(<RunActivityChart data={[]} />);

      expect(screen.getByText('Run Activity')).toBeInTheDocument();
    });
  });

  describe('chart rendering', () => {
    it('renders chart with data', () => {
      render(<RunActivityChart data={mockData} />);

      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    it('shows Run Activity (Last 30 Days) title', () => {
      render(<RunActivityChart data={mockData} />);

      expect(screen.getByText('Run Activity (Last 30 Days)')).toBeInTheDocument();
    });

    it('renders ResponsiveContainer', () => {
      render(<RunActivityChart data={mockData} />);

      expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
    });

    it('renders success bar', () => {
      render(<RunActivityChart data={mockData} />);

      expect(screen.getByTestId('bar-success')).toBeInTheDocument();
    });

    it('renders failed bar', () => {
      render(<RunActivityChart data={mockData} />);

      expect(screen.getByTestId('bar-failed')).toBeInTheDocument();
    });

    it('renders axes', () => {
      render(<RunActivityChart data={mockData} />);

      expect(screen.getByTestId('x-axis')).toBeInTheDocument();
      expect(screen.getByTestId('y-axis')).toBeInTheDocument();
    });

    it('renders legend', () => {
      render(<RunActivityChart data={mockData} />);

      expect(screen.getByTestId('legend')).toBeInTheDocument();
    });

    it('renders tooltip', () => {
      render(<RunActivityChart data={mockData} />);

      expect(screen.getByTestId('tooltip')).toBeInTheDocument();
    });

    it('renders cartesian grid', () => {
      render(<RunActivityChart data={mockData} />);

      expect(screen.getByTestId('cartesian-grid')).toBeInTheDocument();
    });
  });

  describe('data ordering', () => {
    it('passes data length to chart', () => {
      render(<RunActivityChart data={mockData} />);

      const chart = screen.getByTestId('bar-chart');
      expect(chart).toHaveAttribute('data-length', '5');
    });

    it('handles single data point', () => {
      render(<RunActivityChart data={[{ date: '2024-01-15', success: 5, failed: 0 }]} />);

      const chart = screen.getByTestId('bar-chart');
      expect(chart).toHaveAttribute('data-length', '1');
    });
  });

  describe('styling', () => {
    it('has white background card', () => {
      const { container } = render(<RunActivityChart data={mockData} />);
      const card = container.querySelector('.bg-parchment');
      expect(card).toBeInTheDocument();
    });

    it('has rounded corners', () => {
      const { container } = render(<RunActivityChart data={mockData} />);
      const card = container.querySelector('.rounded-lg');
      expect(card).toBeInTheDocument();
    });

    it('has shadow', () => {
      const { container } = render(<RunActivityChart data={mockData} />);
      const card = container.querySelector('.shadow');
      expect(card).toBeInTheDocument();
    });
  });
});
