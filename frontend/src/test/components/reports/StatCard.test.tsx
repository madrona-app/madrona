import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { StatCard } from '../../../components/reports/StatCard';

describe('StatCard', () => {
  describe('basic rendering', () => {
    it('renders label', () => {
      render(<StatCard label="Total Runs" value={100} />);
      expect(screen.getByText('Total Runs')).toBeInTheDocument();
    });

    it('renders numeric value', () => {
      render(<StatCard label="Total Runs" value={100} />);
      expect(screen.getByText('100')).toBeInTheDocument();
    });

    it('renders string value', () => {
      render(<StatCard label="Status" value="Active" />);
      expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('renders subtitle when provided', () => {
      render(<StatCard label="Runs" value={100} subtitle="50 successful" />);
      expect(screen.getByText('50 successful')).toBeInTheDocument();
    });

    it('does not render subtitle when not provided', () => {
      const { container } = render(<StatCard label="Runs" value={100} />);
      // Should only have label and value, no subtitle
      const textElements = container.querySelectorAll('p');
      expect(textElements.length).toBe(2); // label and value
    });
  });

  describe('icon rendering', () => {
    it('renders icon when provided', () => {
      const { container } = render(<StatCard label="Activity" value={10} icon={Activity} />);
      // Icon container is the round wrapper; outer card is rounded-lg, so use rounded-full
      const iconContainer = container.querySelector('.rounded-full');
      expect(iconContainer).toBeInTheDocument();
    });

    it('does not render icon container when not provided', () => {
      const { container } = render(<StatCard label="Activity" value={10} />);
      const iconContainer = container.querySelector('.rounded-full');
      expect(iconContainer).not.toBeInTheDocument();
    });
  });

  describe('number formatting', () => {
    it('formats large numbers with commas', () => {
      render(<StatCard label="Entities" value={1000000} format="number" />);
      expect(screen.getByText('1,000,000')).toBeInTheDocument();
    });

    it('formats small numbers without commas', () => {
      render(<StatCard label="Count" value={100} format="number" />);
      expect(screen.getByText('100')).toBeInTheDocument();
    });

    it('defaults to number format', () => {
      render(<StatCard label="Count" value={10000} />);
      expect(screen.getByText('10,000')).toBeInTheDocument();
    });
  });

  describe('percent formatting', () => {
    it('formats whole percentages', () => {
      render(<StatCard label="Success Rate" value={100} format="percent" />);
      expect(screen.getByText('100.0%')).toBeInTheDocument();
    });

    it('formats decimal percentages', () => {
      render(<StatCard label="Success Rate" value={95.5} format="percent" />);
      expect(screen.getByText('95.5%')).toBeInTheDocument();
    });

    it('formats low percentages', () => {
      render(<StatCard label="Error Rate" value={0.5} format="percent" />);
      expect(screen.getByText('0.5%')).toBeInTheDocument();
    });
  });

  describe('duration formatting', () => {
    it('formats milliseconds', () => {
      render(<StatCard label="Duration" value={500} format="duration" />);
      expect(screen.getByText('500ms')).toBeInTheDocument();
    });

    it('formats seconds', () => {
      render(<StatCard label="Duration" value={5000} format="duration" />);
      expect(screen.getByText('5.0s')).toBeInTheDocument();
    });

    it('formats partial seconds', () => {
      render(<StatCard label="Duration" value={1500} format="duration" />);
      expect(screen.getByText('1.5s')).toBeInTheDocument();
    });

    it('formats minutes', () => {
      render(<StatCard label="Duration" value={120000} format="duration" />);
      expect(screen.getByText('2.0m')).toBeInTheDocument();
    });

    it('formats partial minutes', () => {
      render(<StatCard label="Duration" value={90000} format="duration" />);
      expect(screen.getByText('1.5m')).toBeInTheDocument();
    });

    it('uses ms for sub-second values', () => {
      render(<StatCard label="Duration" value={999} format="duration" />);
      expect(screen.getByText('999ms')).toBeInTheDocument();
    });

    it('uses seconds for values under 1 minute', () => {
      render(<StatCard label="Duration" value={59000} format="duration" />);
      expect(screen.getByText('59.0s')).toBeInTheDocument();
    });
  });

  describe('string values', () => {
    it('renders string values without formatting', () => {
      render(<StatCard label="Status" value="Running" format="number" />);
      expect(screen.getByText('Running')).toBeInTheDocument();
    });

    it('renders string values with percent format without modification', () => {
      render(<StatCard label="Status" value="N/A" format="percent" />);
      expect(screen.getByText('N/A')).toBeInTheDocument();
    });
  });

  describe('styling', () => {
    it('has white background', () => {
      const { container } = render(<StatCard label="Test" value={1} />);
      expect(container.firstChild).toHaveClass('bg-parchment');
    });

    it('has rounded corners', () => {
      const { container } = render(<StatCard label="Test" value={1} />);
      expect(container.firstChild).toHaveClass('rounded-lg');
    });

    it('has shadow', () => {
      const { container } = render(<StatCard label="Test" value={1} />);
      expect(container.firstChild).toHaveClass('shadow');
    });

    it('has padding', () => {
      const { container } = render(<StatCard label="Test" value={1} />);
      expect(container.firstChild).toHaveClass('p-6');
    });
  });
});
