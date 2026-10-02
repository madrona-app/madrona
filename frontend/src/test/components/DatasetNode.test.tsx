import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DatasetNode from '../../components/DatasetNode';
import type { NodeProps } from 'reactflow';
import type { DatasetNodeData } from '../../components/DatasetNode';

// Mock reactflow
vi.mock('reactflow', () => ({
  Handle: ({ type, position, id }: { type: string; position: string; id?: string }) => (
    <div data-testid={`handle-${type}-${position}${id ? `-${id}` : ''}`} />
  ),
  Position: {
    Left: 'left',
    Right: 'right',
    Top: 'top',
    Bottom: 'bottom',
  },
}));

function createNodeProps(data: DatasetNodeData): NodeProps<DatasetNodeData> {
  return {
    id: 'test-node',
    type: 'dataset',
    data,
    selected: false,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    zIndex: 0,
    dragging: false,
  };
}

describe('DatasetNode', () => {
  describe('basic rendering', () => {
    it('renders dataset name', () => {
      render(<DatasetNode {...createNodeProps({ name: 'My Dataset', entityCount: 100 })} />);
      expect(screen.getByText('My Dataset')).toBeInTheDocument();
    });

    it('renders entity count', () => {
      render(<DatasetNode {...createNodeProps({ name: 'Dataset', entityCount: 1234 })} />);
      expect(screen.getByText('1,234 entities')).toBeInTheDocument();
    });

    it('renders handles on left and right', () => {
      render(<DatasetNode {...createNodeProps({ name: 'Dataset', entityCount: 100 })} />);
      expect(screen.getByTestId('handle-target-left-left')).toBeInTheDocument();
      expect(screen.getByTestId('handle-source-right-right')).toBeInTheDocument();
    });

    it('has title attribute with name', () => {
      const { container } = render(
        <DatasetNode {...createNodeProps({ name: 'My Dataset', entityCount: 100 })} />
      );
      expect(container.firstChild).toHaveAttribute('title', 'My Dataset');
    });
  });

  describe('entity count formatting', () => {
    it('formats small numbers', () => {
      render(<DatasetNode {...createNodeProps({ name: 'Dataset', entityCount: 5 })} />);
      expect(screen.getByText('5 entities')).toBeInTheDocument();
    });

    it('formats thousands with commas', () => {
      render(<DatasetNode {...createNodeProps({ name: 'Dataset', entityCount: 10000 })} />);
      expect(screen.getByText('10,000 entities')).toBeInTheDocument();
    });

    it('formats millions', () => {
      render(<DatasetNode {...createNodeProps({ name: 'Dataset', entityCount: 1500000 })} />);
      expect(screen.getByText('1,500,000 entities')).toBeInTheDocument();
    });
  });

  describe('pipeline info', () => {
    it('shows pipeline info when sources exist', () => {
      render(
        <DatasetNode {...createNodeProps({ name: 'Dataset', entityCount: 100, sourceCount: 3 })} />
      );
      expect(screen.getByText(/3 sources → 0 destinations/)).toBeInTheDocument();
    });

    it('shows pipeline info when destinations exist', () => {
      render(
        <DatasetNode
          {...createNodeProps({ name: 'Dataset', entityCount: 100, destinationCount: 2 })}
        />
      );
      expect(screen.getByText(/0 sources → 2 destinations/)).toBeInTheDocument();
    });

    it('shows both sources and destinations', () => {
      render(
        <DatasetNode
          {...createNodeProps({
            name: 'Dataset',
            entityCount: 100,
            sourceCount: 2,
            destinationCount: 3,
          })}
        />
      );
      expect(screen.getByText('2 sources → 3 destinations')).toBeInTheDocument();
    });

    it('uses singular for 1 source', () => {
      render(
        <DatasetNode
          {...createNodeProps({
            name: 'Dataset',
            entityCount: 100,
            sourceCount: 1,
            destinationCount: 0,
          })}
        />
      );
      expect(screen.getByText(/1 source → 0 destinations/)).toBeInTheDocument();
    });

    it('uses singular for 1 destination', () => {
      render(
        <DatasetNode
          {...createNodeProps({
            name: 'Dataset',
            entityCount: 100,
            sourceCount: 0,
            destinationCount: 1,
          })}
        />
      );
      expect(screen.getByText(/0 sources → 1 destination/)).toBeInTheDocument();
    });

    it('hides pipeline info when no sources or destinations', () => {
      render(<DatasetNode {...createNodeProps({ name: 'Dataset', entityCount: 100 })} />);
      expect(screen.queryByText(/sources/)).not.toBeInTheDocument();
      expect(screen.queryByText(/destinations/)).not.toBeInTheDocument();
    });

    it('hides pipeline info when both are 0', () => {
      render(
        <DatasetNode
          {...createNodeProps({
            name: 'Dataset',
            entityCount: 100,
            sourceCount: 0,
            destinationCount: 0,
          })}
        />
      );
      expect(screen.queryByText(/sources/)).not.toBeInTheDocument();
    });
  });

  describe('click handling', () => {
    it('calls onClick when clicked', () => {
      const onClick = vi.fn();
      const { container } = render(
        <DatasetNode {...createNodeProps({ name: 'Clickable', entityCount: 100, onClick })} />
      );

      fireEvent.click(container.firstChild!);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('has pointer cursor when onClick provided', () => {
      const onClick = vi.fn();
      const { container } = render(
        <DatasetNode {...createNodeProps({ name: 'Clickable', entityCount: 100, onClick })} />
      );

      expect(container.firstChild).toHaveStyle({ cursor: 'pointer' });
    });

    it('has default cursor when onClick not provided', () => {
      const { container } = render(
        <DatasetNode {...createNodeProps({ name: 'Not clickable', entityCount: 100 })} />
      );

      expect(container.firstChild).toHaveStyle({ cursor: 'default' });
    });
  });

  describe('keyboard handling', () => {
    it('calls onClick on Enter key', () => {
      const onClick = vi.fn();
      const { container } = render(
        <DatasetNode {...createNodeProps({ name: 'Keyboard', entityCount: 100, onClick })} />
      );

      fireEvent.keyDown(container.firstChild!, { key: 'Enter' });
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('calls onClick on Space key', () => {
      const onClick = vi.fn();
      const { container } = render(
        <DatasetNode {...createNodeProps({ name: 'Keyboard', entityCount: 100, onClick })} />
      );

      fireEvent.keyDown(container.firstChild!, { key: ' ' });
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('does not call onClick on other keys', () => {
      const onClick = vi.fn();
      const { container } = render(
        <DatasetNode {...createNodeProps({ name: 'Keyboard', entityCount: 100, onClick })} />
      );

      fireEvent.keyDown(container.firstChild!, { key: 'Tab' });
      expect(onClick).not.toHaveBeenCalled();
    });

    it('does nothing when no onClick provided', () => {
      const { container } = render(
        <DatasetNode {...createNodeProps({ name: 'Keyboard', entityCount: 100 })} />
      );

      expect(() => {
        fireEvent.keyDown(container.firstChild!, { key: 'Enter' });
      }).not.toThrow();
    });
  });

  describe('highlighted state', () => {
    it('uses highlighted border color when highlighted', () => {
      const { container } = render(
        <DatasetNode
          {...createNodeProps({ name: 'Highlighted', entityCount: 100, highlighted: true })}
        />
      );

      // #8B7355 is rgb(139, 115, 85)
      expect(container.firstChild).toHaveStyle({ borderColor: 'rgb(139, 115, 85)' });
    });

    it('uses normal border color when not highlighted', () => {
      const { container } = render(
        <DatasetNode
          {...createNodeProps({ name: 'Normal', entityCount: 100, highlighted: false })}
        />
      );

      // #B5AFA5 is rgb(181, 175, 165)
      expect(container.firstChild).toHaveStyle({ borderColor: 'rgb(181, 175, 165)' });
    });

    it('defaults to not highlighted', () => {
      const { container } = render(
        <DatasetNode {...createNodeProps({ name: 'Default', entityCount: 100 })} />
      );

      expect(container.firstChild).toHaveStyle({ borderColor: 'rgb(181, 175, 165)' });
    });
  });

  describe('styling', () => {
    it('has gradient background', () => {
      const { container } = render(
        <DatasetNode {...createNodeProps({ name: 'Styled', entityCount: 100 })} />
      );

      expect(container.firstChild).toHaveStyle({
        background: 'linear-gradient(135deg, #FEFDFB 0%, #F9F7F4 100%)',
      });
    });

    it('has border radius', () => {
      const { container } = render(
        <DatasetNode {...createNodeProps({ name: 'Styled', entityCount: 100 })} />
      );

      expect(container.firstChild).toHaveStyle({ borderRadius: '6px' });
    });

    it('has min width constraint', () => {
      const { container } = render(
        <DatasetNode {...createNodeProps({ name: 'Styled', entityCount: 100 })} />
      );

      expect(container.firstChild).toHaveStyle({ minWidth: '200px' });
    });

    it('has min height constraint', () => {
      const { container } = render(
        <DatasetNode {...createNodeProps({ name: 'Styled', entityCount: 100 })} />
      );

      expect(container.firstChild).toHaveStyle({ minHeight: '95px' });
    });
  });
});
