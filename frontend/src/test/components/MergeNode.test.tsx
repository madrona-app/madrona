import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import MergeNode from '../../components/MergeNode';

// Mock reactflow
vi.mock('reactflow', () => ({
  Handle: ({ type, position }: { type: string; position: string }) => (
    <div data-testid={`handle-${type}-${position}`} />
  ),
  Position: {
    Left: 'left',
    Right: 'right',
    Top: 'top',
    Bottom: 'bottom',
  },
  memo: (Component: any) => Component,
}));

describe('MergeNode', () => {
  describe('rendering', () => {
    it('renders MERGE label', () => {
      render(<MergeNode data={{}} />);
      expect(screen.getByText('MERGE')).toBeInTheDocument();
    });

    it('renders target handle on left', () => {
      render(<MergeNode data={{}} />);
      expect(screen.getByTestId('handle-target-left')).toBeInTheDocument();
    });

    it('renders source handle on right', () => {
      render(<MergeNode data={{}} />);
      expect(screen.getByTestId('handle-source-right')).toBeInTheDocument();
    });

    it('renders merge icon SVG', () => {
      const { container } = render(<MergeNode data={{}} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('has title tooltip', () => {
      render(<MergeNode data={{}} />);
      expect(screen.getByTitle(/sources are merged/i)).toBeInTheDocument();
    });
  });

  describe('source count', () => {
    it('shows default source count of 2 sources', () => {
      render(<MergeNode data={{}} />);
      expect(screen.getByText('2 sources')).toBeInTheDocument();
    });

    it('shows custom source count', () => {
      render(<MergeNode data={{ sourceCount: 5 }} />);
      expect(screen.getByText('5 sources')).toBeInTheDocument();
    });

    it('shows singular "source" for count of 1', () => {
      render(<MergeNode data={{ sourceCount: 1 }} />);
      expect(screen.getByText('1 source')).toBeInTheDocument();
    });

    it('shows plural "sources" for count > 1', () => {
      render(<MergeNode data={{ sourceCount: 3 }} />);
      expect(screen.getByText('3 sources')).toBeInTheDocument();
    });
  });

  describe('styling', () => {
    it('has merge-node class', () => {
      const { container } = render(<MergeNode data={{}} />);
      expect(container.querySelector('.merge-node')).toBeInTheDocument();
    });

    it('has correct background gradient', () => {
      const { container } = render(<MergeNode data={{}} />);
      const node = container.querySelector('.merge-node');
      expect(node).toHaveStyle({
        background: 'linear-gradient(135deg, #FFFFFF 0%, #F8F6F3 100%)',
      });
    });

    it('has border styling', () => {
      const { container } = render(<MergeNode data={{}} />);
      const node = container.querySelector('.merge-node');
      expect(node).toHaveStyle({ borderRadius: '8px' });
    });

    it('has correct text alignment', () => {
      const { container } = render(<MergeNode data={{}} />);
      const node = container.querySelector('.merge-node');
      expect(node).toHaveStyle({ textAlign: 'center' });
    });

    it('has minimum width', () => {
      const { container } = render(<MergeNode data={{}} />);
      const node = container.querySelector('.merge-node');
      expect(node).toHaveStyle({ minWidth: '100px' });
    });
  });
});
