import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MadronaContainerNode from '../../components/MadronaContainerNode';

describe('MadronaContainerNode', () => {
  const mockNodeProps = {
    id: 'node-1',
    type: 'madronaContainer',
    xPos: 0,
    yPos: 0,
    zIndex: 1,
    selected: false,
    isConnectable: false,
    dragging: false,
  };

  describe('rendering', () => {
    it('renders container div', () => {
      render(
        <MadronaContainerNode
          {...mockNodeProps}
          data={{ onClick: vi.fn() }}
        />
      );

      const container = screen.getByTitle('Canonical Store');
      expect(container).toBeInTheDocument();
    });

    it('renders without onClick handler', () => {
      const { container } = render(
        <MadronaContainerNode
          {...mockNodeProps}
          data={{}}
        />
      );

      expect(container.firstChild).toBeInTheDocument();
    });

    it('has correct styles', () => {
      const { container } = render(
        <MadronaContainerNode
          {...mockNodeProps}
          data={{ onClick: vi.fn() }}
        />
      );

      const div = container.firstChild as HTMLElement;
      expect(div).toHaveStyle({ cursor: 'pointer' });
    });

    it('has default cursor when no onClick', () => {
      const { container } = render(
        <MadronaContainerNode
          {...mockNodeProps}
          data={{}}
        />
      );

      const div = container.firstChild as HTMLElement;
      expect(div).toHaveStyle({ cursor: 'default' });
    });
  });

  describe('interactions', () => {
    it('calls onClick when clicked', () => {
      const onClick = vi.fn();
      render(
        <MadronaContainerNode
          {...mockNodeProps}
          data={{ onClick }}
        />
      );

      const container = screen.getByRole('button');
      fireEvent.click(container);

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('does not throw when clicked without onClick', () => {
      const { container } = render(
        <MadronaContainerNode
          {...mockNodeProps}
          data={{}}
        />
      );

      expect(() => {
        fireEvent.click(container.firstChild as HTMLElement);
      }).not.toThrow();
    });

    it('calls onClick on Enter key', () => {
      const onClick = vi.fn();
      render(
        <MadronaContainerNode
          {...mockNodeProps}
          data={{ onClick }}
        />
      );

      const container = screen.getByRole('button');
      fireEvent.keyDown(container, { key: 'Enter' });

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('calls onClick on Space key', () => {
      const onClick = vi.fn();
      render(
        <MadronaContainerNode
          {...mockNodeProps}
          data={{ onClick }}
        />
      );

      const container = screen.getByRole('button');
      fireEvent.keyDown(container, { key: ' ' });

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('does not call onClick on other keys', () => {
      const onClick = vi.fn();
      render(
        <MadronaContainerNode
          {...mockNodeProps}
          data={{ onClick }}
        />
      );

      const container = screen.getByRole('button');
      fireEvent.keyDown(container, { key: 'Tab' });

      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('has button role when onClick provided', () => {
      render(
        <MadronaContainerNode
          {...mockNodeProps}
          data={{ onClick: vi.fn() }}
        />
      );

      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('has no role when onClick not provided', () => {
      const { container } = render(
        <MadronaContainerNode
          {...mockNodeProps}
          data={{}}
        />
      );

      expect(container.querySelector('[role="button"]')).not.toBeInTheDocument();
    });

    it('has tabIndex 0 when onClick provided', () => {
      render(
        <MadronaContainerNode
          {...mockNodeProps}
          data={{ onClick: vi.fn() }}
        />
      );

      const container = screen.getByRole('button');
      expect(container).toHaveAttribute('tabIndex', '0');
    });

    it('has title when onClick provided', () => {
      render(
        <MadronaContainerNode
          {...mockNodeProps}
          data={{ onClick: vi.fn() }}
        />
      );

      expect(screen.getByTitle('Canonical Store')).toBeInTheDocument();
    });
  });

  describe('hover behavior', () => {
    it('changes border color on mouse enter when clickable', () => {
      const { container } = render(
        <MadronaContainerNode
          {...mockNodeProps}
          data={{ onClick: vi.fn() }}
        />
      );

      const div = container.firstChild as HTMLElement;
      fireEvent.mouseEnter(div);

      expect(div.style.borderColor).toBe('rgb(173, 167, 157)');
    });

    it('resets border color on mouse leave', () => {
      const { container } = render(
        <MadronaContainerNode
          {...mockNodeProps}
          data={{ onClick: vi.fn() }}
        />
      );

      const div = container.firstChild as HTMLElement;
      fireEvent.mouseEnter(div);
      fireEvent.mouseLeave(div);

      expect(div.style.borderColor).toBe('rgb(197, 191, 181)');
    });

    it('does not change border color when not clickable', () => {
      const { container } = render(
        <MadronaContainerNode
          {...mockNodeProps}
          data={{}}
        />
      );

      const div = container.firstChild as HTMLElement;
      const originalBorder = div.style.borderColor;
      fireEvent.mouseEnter(div);

      expect(div.style.borderColor).toBe(originalBorder);
    });
  });
});
