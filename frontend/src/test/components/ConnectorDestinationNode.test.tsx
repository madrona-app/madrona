import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConnectorDestinationNode from '../../components/ConnectorDestinationNode';
import type { NodeProps } from 'reactflow';
import type { ConnectorDestinationNodeData } from '../../components/ConnectorDestinationNode';

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
}));

function createNodeProps(data: ConnectorDestinationNodeData): NodeProps<ConnectorDestinationNodeData> {
  return {
    id: 'test-node',
    type: 'connectorDestination',
    data,
    selected: false,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    zIndex: 0,
    dragging: false,
  };
}

describe('ConnectorDestinationNode', () => {
  describe('basic rendering', () => {
    it('renders connector name', () => {
      render(<ConnectorDestinationNode {...createNodeProps({ name: 'My Destination' })} />);
      expect(screen.getByText('My Destination')).toBeInTheDocument();
    });

    it('renders target handle on left', () => {
      render(<ConnectorDestinationNode {...createNodeProps({ name: 'Test' })} />);
      expect(screen.getByTestId('handle-target-left')).toBeInTheDocument();
    });
  });

  describe('lastSync display', () => {
    it('shows lastSync when provided', () => {
      render(
        <ConnectorDestinationNode
          {...createNodeProps({ name: 'Destination', lastSync: '1 hour ago' })}
        />
      );
      expect(screen.getByText('1 hour ago')).toBeInTheDocument();
    });

    it('does not show lastSync when not provided', () => {
      render(<ConnectorDestinationNode {...createNodeProps({ name: 'Destination' })} />);
      expect(screen.queryByText('1 hour ago')).not.toBeInTheDocument();
    });
  });

  describe('click handling', () => {
    it('calls onClick when clicked', () => {
      const onClick = vi.fn();
      const { container } = render(
        <ConnectorDestinationNode {...createNodeProps({ name: 'Clickable', onClick })} />
      );

      fireEvent.click(container.firstChild!);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('has pointer cursor when onClick provided', () => {
      const onClick = vi.fn();
      const { container } = render(
        <ConnectorDestinationNode {...createNodeProps({ name: 'Clickable', onClick })} />
      );

      expect(container.firstChild).toHaveStyle({ cursor: 'pointer' });
    });

    it('has default cursor when onClick not provided', () => {
      const { container } = render(
        <ConnectorDestinationNode {...createNodeProps({ name: 'Not clickable' })} />
      );

      expect(container.firstChild).toHaveStyle({ cursor: 'default' });
    });
  });

  describe('keyboard handling', () => {
    it('calls onClick on Enter key', () => {
      const onClick = vi.fn();
      const { container } = render(
        <ConnectorDestinationNode {...createNodeProps({ name: 'Keyboard', onClick })} />
      );

      fireEvent.keyDown(container.firstChild!, { key: 'Enter' });
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('calls onClick on Space key', () => {
      const onClick = vi.fn();
      const { container } = render(
        <ConnectorDestinationNode {...createNodeProps({ name: 'Keyboard', onClick })} />
      );

      fireEvent.keyDown(container.firstChild!, { key: ' ' });
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('does not call onClick on other keys', () => {
      const onClick = vi.fn();
      const { container } = render(
        <ConnectorDestinationNode {...createNodeProps({ name: 'Keyboard', onClick })} />
      );

      fireEvent.keyDown(container.firstChild!, { key: 'Tab' });
      expect(onClick).not.toHaveBeenCalled();
    });

    it('does nothing when no onClick provided', () => {
      const { container } = render(
        <ConnectorDestinationNode {...createNodeProps({ name: 'Keyboard' })} />
      );

      expect(() => {
        fireEvent.keyDown(container.firstChild!, { key: 'Enter' });
      }).not.toThrow();
    });
  });

  describe('title attribute', () => {
    it('has title attribute when not placeholder', () => {
      const { container } = render(
        <ConnectorDestinationNode {...createNodeProps({ name: 'My Destination' })} />
      );

      expect(container.firstChild).toHaveAttribute('title', 'My Destination');
    });

    it('does not have title when is placeholder', () => {
      const { container } = render(
        <ConnectorDestinationNode {...createNodeProps({ name: 'Add', isPlaceholder: true })} />
      );

      expect(container.firstChild).not.toHaveAttribute('title');
    });
  });

  describe('placeholder state', () => {
    it('uses muted text color for placeholder', () => {
      render(
        <ConnectorDestinationNode {...createNodeProps({ name: 'Placeholder', isPlaceholder: true })} />
      );

      const nameElement = screen.getByText('Placeholder');
      // Placeholder text is #B5AFA5 instead of #6B7A7E
      expect(nameElement).toHaveStyle({ color: 'rgb(181, 175, 165)' });
    });

    it('uses normal text color when not placeholder', () => {
      render(<ConnectorDestinationNode {...createNodeProps({ name: 'Normal' })} />);

      const nameElement = screen.getByText('Normal');
      expect(nameElement).toHaveStyle({ color: 'rgb(var(--color-archive))' });
    });

    it('defaults isPlaceholder to false', () => {
      render(<ConnectorDestinationNode {...createNodeProps({ name: 'Normal' })} />);

      const nameElement = screen.getByText('Normal');
      expect(nameElement).toHaveStyle({ color: 'rgb(var(--color-archive))' });
    });
  });

  describe('hover behavior', () => {
    it('changes opacity on mouse enter when clickable', () => {
      const onClick = vi.fn();
      const { container } = render(
        <ConnectorDestinationNode {...createNodeProps({ name: 'Hoverable', onClick })} />
      );

      fireEvent.mouseEnter(container.firstChild!);
      expect(container.firstChild).toHaveStyle({ opacity: '1' });
    });

    it('restores opacity on mouse leave', () => {
      const onClick = vi.fn();
      const { container } = render(
        <ConnectorDestinationNode {...createNodeProps({ name: 'Hoverable', onClick })} />
      );

      fireEvent.mouseEnter(container.firstChild!);
      fireEvent.mouseLeave(container.firstChild!);
      expect(container.firstChild).toHaveStyle({ opacity: '0.75' });
    });

    it('does not change on hover for placeholder', () => {
      const onClick = vi.fn();
      const { container } = render(
        <ConnectorDestinationNode
          {...createNodeProps({ name: 'Placeholder', isPlaceholder: true, onClick })}
        />
      );

      const initialOpacity = (container.firstChild as HTMLElement).style.opacity;
      fireEvent.mouseEnter(container.firstChild!);
      // Placeholder should not change opacity on hover when onClick is provided but isPlaceholder is true
      expect(container.firstChild).toHaveStyle({ opacity: initialOpacity || '0.75' });
    });
  });

  describe('styling', () => {
    it('has correct background color', () => {
      const { container } = render(
        <ConnectorDestinationNode {...createNodeProps({ name: 'Styled' })} />
      );

      expect(container.firstChild).toHaveStyle({ background: '#FCFCFB' });
    });

    it('has correct border radius', () => {
      const { container } = render(
        <ConnectorDestinationNode {...createNodeProps({ name: 'Styled' })} />
      );

      expect(container.firstChild).toHaveStyle({ borderRadius: '2px' });
    });

    it('has min and max width constraints', () => {
      const { container } = render(
        <ConnectorDestinationNode {...createNodeProps({ name: 'Styled' })} />
      );

      expect(container.firstChild).toHaveStyle({ minWidth: '160px' });
      expect(container.firstChild).toHaveStyle({ maxWidth: '200px' });
    });

    it('has de-emphasized opacity', () => {
      const { container } = render(
        <ConnectorDestinationNode {...createNodeProps({ name: 'Styled' })} />
      );

      expect(container.firstChild).toHaveStyle({ opacity: '0.75' });
    });
  });
});
