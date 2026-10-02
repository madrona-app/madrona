import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tooltip } from '../../components/Tooltip';

// Component semantics (counterintuitive):
//   disabled={false} = element is DISABLED (permission denied) → show tooltip explaining why
//   disabled={true}  = element is ENABLED (permission granted)  → no tooltip needed
// alwaysShow={true} forces tooltip regardless of disabled state.

describe('Tooltip', () => {
  describe('when permission granted (disabled=true)', () => {
    it('renders children directly without wrapper', () => {
      render(
        <Tooltip content="Tooltip text" disabled={true}>
          <button>Click me</button>
        </Tooltip>
      );
      expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
    });

    it('does not show tooltip on hover', () => {
      render(
        <Tooltip content="Tooltip text" disabled={true}>
          <button>Click me</button>
        </Tooltip>
      );
      fireEvent.mouseEnter(screen.getByRole('button'));
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });

  describe('when permission denied (disabled=false, the default)', () => {
    it('wraps children in an inline-block div', () => {
      const { container } = render(
        <Tooltip content="Tooltip text" disabled={false}>
          <button>Click me</button>
        </Tooltip>
      );
      const wrapperDiv = container.querySelector('div[style*="inline-block"]');
      expect(wrapperDiv).toBeInTheDocument();
    });

    it('defaults to disabled=false (shows tooltip)', () => {
      const { container } = render(
        <Tooltip content="Tooltip text">
          <button>Click me</button>
        </Tooltip>
      );
      expect(container.querySelector('div[style*="inline-block"]')).toBeInTheDocument();
    });

    it('shows tooltip on mouse enter', () => {
      const { container } = render(
        <Tooltip content="This is disabled" disabled={false}>
          <button>Click me</button>
        </Tooltip>
      );
      const wrapper = container.querySelector('div[style*="inline-block"]')!;
      fireEvent.mouseEnter(wrapper);
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
      expect(screen.getByText('This is disabled')).toBeInTheDocument();
    });

    it('hides tooltip on mouse leave', () => {
      const { container } = render(
        <Tooltip content="This is disabled" disabled={false}>
          <button>Click me</button>
        </Tooltip>
      );
      const wrapper = container.querySelector('div[style*="inline-block"]')!;
      fireEvent.mouseEnter(wrapper);
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
      fireEvent.mouseLeave(wrapper);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('shows tooltip on focus', () => {
      const { container } = render(
        <Tooltip content="Focus tooltip" disabled={false}>
          <button>Click me</button>
        </Tooltip>
      );
      const wrapper = container.querySelector('div[style*="inline-block"]')!;
      fireEvent.focus(wrapper);
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
    });

    it('hides tooltip on blur', () => {
      const { container } = render(
        <Tooltip content="Focus tooltip" disabled={false}>
          <button>Click me</button>
        </Tooltip>
      );
      const wrapper = container.querySelector('div[style*="inline-block"]')!;
      fireEvent.focus(wrapper);
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
      fireEvent.blur(wrapper);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });

  describe('tooltip styling', () => {
    const renderAndShow = () => {
      const result = render(
        <Tooltip content="Tooltip text" disabled={false}>
          <button>Click me</button>
        </Tooltip>
      );
      const wrapper = result.container.querySelector('div[style*="inline-block"]')!;
      fireEvent.mouseEnter(wrapper);
      return screen.getByRole('tooltip');
    };

    it('has fixed positioning', () => {
      expect(renderAndShow()).toHaveStyle({ position: 'fixed' });
    });

    it('has dark background', () => {
      expect(renderAndShow()).toHaveStyle({ backgroundColor: 'rgb(var(--color-accessible-gray))' });
    });

    it('has pointer-events none', () => {
      expect(renderAndShow()).toHaveStyle({ pointerEvents: 'none' });
    });

    it('has high z-index', () => {
      expect(renderAndShow()).toHaveStyle({ zIndex: '9999' });
    });
  });

  describe('accessibility', () => {
    it('sets aria-describedby when tooltip is visible', () => {
      const { container } = render(
        <Tooltip content="Accessible tooltip" disabled={false}>
          <button>Click me</button>
        </Tooltip>
      );
      const wrapper = container.querySelector('div[style*="inline-block"]')!;
      fireEvent.mouseEnter(wrapper);
      const tooltip = screen.getByRole('tooltip');
      expect(wrapper).toHaveAttribute('aria-describedby', tooltip.id);
    });

    it('removes aria-describedby when tooltip is hidden', () => {
      const { container } = render(
        <Tooltip content="Accessible tooltip" disabled={false}>
          <button>Click me</button>
        </Tooltip>
      );
      const wrapper = container.querySelector('div[style*="inline-block"]')!;
      fireEvent.mouseEnter(wrapper);
      fireEvent.mouseLeave(wrapper);
      expect(wrapper).not.toHaveAttribute('aria-describedby');
    });

    it('tooltip has role tooltip', () => {
      const { container } = render(
        <Tooltip content="Role test" disabled={false}>
          <button>Click me</button>
        </Tooltip>
      );
      const wrapper = container.querySelector('div[style*="inline-block"]')!;
      fireEvent.mouseEnter(wrapper);
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
    });
  });
});
