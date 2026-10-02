import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConnectorSourceNode from '../../components/ConnectorSourceNode';
import type { NodeProps } from 'reactflow';
import type { ConnectorSourceNodeData } from '../../components/ConnectorSourceNode';

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

function createNodeProps(data: ConnectorSourceNodeData): NodeProps<ConnectorSourceNodeData> {
  return {
    id: 'test-node',
    type: 'connectorSource',
    data,
    selected: false,
    isConnectable: true,
    xPos: 0,
    yPos: 0,
    zIndex: 0,
    dragging: false,
  };
}

describe('ConnectorSourceNode', () => {
  describe('basic rendering', () => {
    it('renders connector name', () => {
      render(<ConnectorSourceNode {...createNodeProps({ name: 'My Connector' })} />);
      expect(screen.getByText('My Connector')).toBeInTheDocument();
    });

    it('renders source handle', () => {
      render(<ConnectorSourceNode {...createNodeProps({ name: 'Test' })} />);
      expect(screen.getByTestId('handle-source-right')).toBeInTheDocument();
    });
  });

  describe('lastSync display', () => {
    it('shows lastSync when provided', () => {
      render(
        <ConnectorSourceNode
          {...createNodeProps({ name: 'Connector', lastSync: '2 hours ago' })}
        />
      );
      expect(screen.getByText('2 hours ago')).toBeInTheDocument();
    });

    it('does not show lastSync when not provided', () => {
      render(<ConnectorSourceNode {...createNodeProps({ name: 'Connector' })} />);
      expect(screen.queryByText('2 hours ago')).not.toBeInTheDocument();
    });
  });

  describe('click handling', () => {
    it('calls onClick when clicked', () => {
      const onClick = vi.fn();
      const { container } = render(
        <ConnectorSourceNode {...createNodeProps({ name: 'Clickable', onClick })} />
      );

      fireEvent.click(container.firstChild!);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('has pointer cursor when onClick provided', () => {
      const onClick = vi.fn();
      const { container } = render(
        <ConnectorSourceNode {...createNodeProps({ name: 'Clickable', onClick })} />
      );

      expect(container.firstChild).toHaveStyle({ cursor: 'pointer' });
    });

    it('has default cursor when onClick not provided', () => {
      const { container } = render(
        <ConnectorSourceNode {...createNodeProps({ name: 'Not clickable' })} />
      );

      expect(container.firstChild).toHaveStyle({ cursor: 'default' });
    });
  });

  describe('keyboard handling', () => {
    it('calls onClick on Enter key', () => {
      const onClick = vi.fn();
      const { container } = render(
        <ConnectorSourceNode {...createNodeProps({ name: 'Keyboard', onClick })} />
      );

      fireEvent.keyDown(container.firstChild!, { key: 'Enter' });
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('calls onClick on Space key', () => {
      const onClick = vi.fn();
      const { container } = render(
        <ConnectorSourceNode {...createNodeProps({ name: 'Keyboard', onClick })} />
      );

      fireEvent.keyDown(container.firstChild!, { key: ' ' });
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('does not call onClick on other keys', () => {
      const onClick = vi.fn();
      const { container } = render(
        <ConnectorSourceNode {...createNodeProps({ name: 'Keyboard', onClick })} />
      );

      fireEvent.keyDown(container.firstChild!, { key: 'Tab' });
      expect(onClick).not.toHaveBeenCalled();
    });

    it('does nothing when no onClick provided', () => {
      const { container } = render(
        <ConnectorSourceNode {...createNodeProps({ name: 'Keyboard' })} />
      );

      expect(() => {
        fireEvent.keyDown(container.firstChild!, { key: 'Enter' });
      }).not.toThrow();
    });
  });

  describe('title attribute', () => {
    it('has title attribute when not placeholder', () => {
      const { container } = render(
        <ConnectorSourceNode {...createNodeProps({ name: 'My Connector' })} />
      );

      expect(container.firstChild).toHaveAttribute('title', 'My Connector');
    });

    it('does not have title when is placeholder', () => {
      const { container } = render(
        <ConnectorSourceNode {...createNodeProps({ name: 'Add connector', isPlaceholder: true })} />
      );

      expect(container.firstChild).not.toHaveAttribute('title');
    });
  });

  describe('placeholder state', () => {
    it('uses different text color for placeholder', () => {
      render(
        <ConnectorSourceNode {...createNodeProps({ name: 'Placeholder', isPlaceholder: true })} />
      );

      const nameElement = screen.getByText('Placeholder');
      // Placeholder text is #9B9389 (muted) instead of #1F3A2E (normal)
      expect(nameElement).toHaveStyle({ color: 'rgb(155, 147, 137)' });
    });

    it('uses normal text color when not placeholder', () => {
      render(<ConnectorSourceNode {...createNodeProps({ name: 'Normal' })} />);

      const nameElement = screen.getByText('Normal');
      expect(nameElement).toHaveStyle({ color: 'rgb(var(--color-forest))' });
    });

    it('defaults isPlaceholder to false', () => {
      render(<ConnectorSourceNode {...createNodeProps({ name: 'Normal' })} />);

      const nameElement = screen.getByText('Normal');
      // Default (non-placeholder) should have normal color
      expect(nameElement).toHaveStyle({ color: 'rgb(var(--color-forest))' });
    });
  });

  describe('hover behavior', () => {
    it('changes border color on mouse enter when clickable', () => {
      const onClick = vi.fn();
      const { container } = render(
        <ConnectorSourceNode {...createNodeProps({ name: 'Hoverable', onClick })} />
      );

      fireEvent.mouseEnter(container.firstChild!);
      expect(container.firstChild).toHaveStyle({ borderColor: '#ADA79D' });
    });

    it('restores border color on mouse leave', () => {
      const onClick = vi.fn();
      const { container } = render(
        <ConnectorSourceNode {...createNodeProps({ name: 'Hoverable', onClick })} />
      );

      fireEvent.mouseEnter(container.firstChild!);
      expect(container.firstChild).toHaveStyle({ borderColor: '#ADA79D' });
      fireEvent.mouseLeave(container.firstChild!);
      // Restored to the var-based default. jsdom's border-color setter drops
      // rgb(var(...)) (its color setter keeps it; border-color validates
      // strictly), so we assert the hover hex is gone rather than the resolved
      // default — the default is correct in real browsers.
      expect(container.firstChild).not.toHaveStyle({ borderColor: '#ADA79D' });
    });

    it('does not change border on hover for placeholder', () => {
      const onClick = vi.fn();
      const { container } = render(
        <ConnectorSourceNode
          {...createNodeProps({ name: 'Placeholder', isPlaceholder: true, onClick })}
        />
      );

      fireEvent.mouseEnter(container.firstChild!);
      // Should keep placeholder border color
      expect(container.firstChild).toHaveStyle({ borderColor: '#E8E4DC' });
    });
  });

  describe('styling', () => {
    it('has correct background color', () => {
      const { container } = render(
        <ConnectorSourceNode {...createNodeProps({ name: 'Styled' })} />
      );

      expect(container.firstChild).toHaveStyle({ background: 'rgb(var(--color-parchment))' });
    });

    it('has correct border radius', () => {
      const { container } = render(
        <ConnectorSourceNode {...createNodeProps({ name: 'Styled' })} />
      );

      expect(container.firstChild).toHaveStyle({ borderRadius: '2px' });
    });

    it('has min and max width constraints', () => {
      const { container } = render(
        <ConnectorSourceNode {...createNodeProps({ name: 'Styled' })} />
      );

      expect(container.firstChild).toHaveStyle({ minWidth: '180px' });
      expect(container.firstChild).toHaveStyle({ maxWidth: '220px' });
    });
  });
});
