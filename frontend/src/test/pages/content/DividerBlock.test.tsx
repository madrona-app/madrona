import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  DividerEditor,
  DividerRenderer,
} from '../../../pages/content/components/blocks/DividerBlock';

describe('DividerEditor', () => {
  it('renders the three style options', () => {
    render(<DividerEditor content={{}} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Line' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Space' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dots' })).toBeInTheDocument();
  });

  it('calls onChange with selected style', () => {
    const onChange = vi.fn();
    render(<DividerEditor content={{}} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dots' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ style: 'dots' }));
  });

  it('renders preview heading', () => {
    render(<DividerEditor content={{ style: 'line' }} onChange={vi.fn()} />);
    expect(screen.getByText('Preview:')).toBeInTheDocument();
  });
});

describe('DividerRenderer', () => {
  it('renders an hr element for line style', () => {
    const { container } = render(<DividerRenderer content={{ style: 'line' }} />);
    expect(container.querySelector('hr')).not.toBeNull();
  });

  it('renders an hr element when style is unspecified (default)', () => {
    const { container } = render(<DividerRenderer content={{}} />);
    expect(container.querySelector('hr')).not.toBeNull();
  });

  it('renders empty space div for space style', () => {
    const { container } = render(<DividerRenderer content={{ style: 'space' }} />);
    expect(container.querySelector('hr')).toBeNull();
    expect(container.querySelector('div[aria-hidden="true"]')).not.toBeNull();
  });

  it('renders three dots for dots style', () => {
    const { container } = render(<DividerRenderer content={{ style: 'dots' }} />);
    const dots = container.querySelectorAll('span');
    expect(dots.length).toBe(3);
  });
});
