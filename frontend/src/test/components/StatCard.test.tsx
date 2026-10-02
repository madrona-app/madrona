import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { StatCard } from '../../components/reports/StatCard';

describe('StatCard', () => {
  describe('basic rendering', () => {
    it('renders label', () => {
      render(<StatCard label="Total Users" value={100} />);
      expect(screen.getByText('Total Users')).toBeInTheDocument();
    });

    it('renders string value as-is', () => {
      render(<StatCard label="Status" value="Active" />);
      expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('renders subtitle when provided', () => {
      render(<StatCard label="Count" value={50} subtitle="Last 24 hours" />);
      expect(screen.getByText('Last 24 hours')).toBeInTheDocument();
    });

    it('does not render subtitle when not provided', () => {
      render(<StatCard label="Count" value={50} />);
      expect(screen.queryByText('Last 24 hours')).not.toBeInTheDocument();
    });
  });

  describe('number formatting', () => {
    it('formats number with locale separators', () => {
      render(<StatCard label="Users" value={1234567} format="number" />);
      // toLocaleString will format as "1,234,567" in en-US
      expect(screen.getByText('1,234,567')).toBeInTheDocument();
    });

    it('uses number format by default', () => {
      render(<StatCard label="Count" value={5000} />);
      expect(screen.getByText('5,000')).toBeInTheDocument();
    });
  });

  describe('percent formatting', () => {
    it('formats as percentage', () => {
      render(<StatCard label="Success Rate" value={95.567} format="percent" />);
      expect(screen.getByText('95.6%')).toBeInTheDocument();
    });

    it('handles 0 percent', () => {
      render(<StatCard label="Failure Rate" value={0} format="percent" />);
      expect(screen.getByText('0.0%')).toBeInTheDocument();
    });

    it('handles 100 percent', () => {
      render(<StatCard label="Completion" value={100} format="percent" />);
      expect(screen.getByText('100.0%')).toBeInTheDocument();
    });
  });

  describe('duration formatting', () => {
    it('formats milliseconds (< 1000ms)', () => {
      render(<StatCard label="Response Time" value={500} format="duration" />);
      expect(screen.getByText('500ms')).toBeInTheDocument();
    });

    it('formats seconds (1000-60000ms)', () => {
      render(<StatCard label="Response Time" value={5000} format="duration" />);
      expect(screen.getByText('5.0s')).toBeInTheDocument();
    });

    it('formats seconds with decimal', () => {
      render(<StatCard label="Response Time" value={2500} format="duration" />);
      expect(screen.getByText('2.5s')).toBeInTheDocument();
    });

    it('formats minutes (> 60000ms)', () => {
      render(<StatCard label="Duration" value={120000} format="duration" />);
      expect(screen.getByText('2.0m')).toBeInTheDocument();
    });

    it('formats minutes with decimal', () => {
      render(<StatCard label="Duration" value={90000} format="duration" />);
      expect(screen.getByText('1.5m')).toBeInTheDocument();
    });

    it('handles edge case at exactly 1000ms', () => {
      render(<StatCard label="Time" value={1000} format="duration" />);
      expect(screen.getByText('1.0s')).toBeInTheDocument();
    });

    it('handles edge case at exactly 60000ms', () => {
      render(<StatCard label="Time" value={60000} format="duration" />);
      expect(screen.getByText('1.0m')).toBeInTheDocument();
    });
  });

  describe('icon rendering', () => {
    it('renders icon when provided', () => {
      const { container } = render(<StatCard label="Activity" value={10} icon={Activity} />);
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('does not render icon container when not provided', () => {
      const { container } = render(<StatCard label="Count" value={10} />);
      const iconContainer = container.querySelector('.p-3.bg-parchment');
      expect(iconContainer).not.toBeInTheDocument();
    });
  });

  describe('styling', () => {
    it('has card styling', () => {
      const { container } = render(<StatCard label="Test" value={0} />);
      const card = container.firstChild;
      expect(card).toHaveClass('bg-parchment');
      expect(card).toHaveClass('rounded-lg');
      expect(card).toHaveClass('shadow');
      expect(card).toHaveClass('p-6');
    });
  });
});
