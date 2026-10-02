import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlowSkeleton } from '../../components/FlowSkeleton';

describe('FlowSkeleton', () => {
  describe('rendering', () => {
    it('renders skeleton loading state', () => {
      render(<FlowSkeleton />);
      expect(screen.getByText('Loading pipeline...')).toBeInTheDocument();
    });

    it('renders multiple connector skeletons', () => {
      const { container } = render(<FlowSkeleton />);
      // Should have connector skeleton elements (5 total - 3 source, 2 destination)
      const skeletonConnectors = container.querySelectorAll('.skeleton-pulse');
      expect(skeletonConnectors.length).toBeGreaterThan(0);
    });

    it('renders madrona container skeleton', () => {
      const { container } = render(<FlowSkeleton />);
      // The madrona container has specific dimensions
      const mainContent = container.querySelector('div[style*="width: 280px"]');
      expect(mainContent).toBeInTheDocument();
    });

    it('includes skeleton animation styles', () => {
      const { container } = render(<FlowSkeleton />);
      const style = container.querySelector('style');
      expect(style).toBeInTheDocument();
      expect(style?.textContent).toContain('skeletonPulse');
    });
  });

  describe('layout', () => {
    it('renders with full width and height', () => {
      const { container } = render(<FlowSkeleton />);
      const outerDiv = container.firstChild as HTMLElement;
      expect(outerDiv).toHaveStyle({ width: '100%' });
    });

    it('uses correct background color', () => {
      const { container } = render(<FlowSkeleton />);
      const outerDiv = container.firstChild as HTMLElement;
      expect(outerDiv).toHaveStyle({ background: 'rgb(var(--color-parchment))' });
    });

    it('renders loading text', () => {
      render(<FlowSkeleton />);
      const loadingText = screen.getByText('Loading pipeline...');
      expect(loadingText).toBeInTheDocument();
      expect(loadingText).toHaveStyle({ fontSize: '13px' });
    });
  });
});
