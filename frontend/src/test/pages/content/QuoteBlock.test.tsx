import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  QuoteEditor,
  QuoteRenderer,
} from '../../../pages/content/components/blocks/QuoteBlock';

describe('QuoteEditor', () => {
  it('renders quote and attribution fields', () => {
    render(<QuoteEditor content={{}} onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText(/Enter the quote/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/John Ruskin/i)).toBeInTheDocument();
  });

  it('shows existing values', () => {
    render(
      <QuoteEditor
        content={{ text: 'be the change', attribution: 'Gandhi' }}
        onChange={vi.fn()}
      />,
    );
    expect((screen.getByPlaceholderText(/Enter the quote/i) as HTMLTextAreaElement).value).toBe(
      'be the change',
    );
    expect(
      (screen.getByPlaceholderText(/John Ruskin/i) as HTMLInputElement).value,
    ).toBe('Gandhi');
  });

  it('emits onChange when typing', () => {
    const onChange = vi.fn();
    render(<QuoteEditor content={{ attribution: 'a' }} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/Enter the quote/i), {
      target: { value: 'wisdom' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'wisdom', attribution: 'a' }),
    );
  });
});

describe('QuoteRenderer', () => {
  it('renders nothing if text is missing', () => {
    const { container } = render(<QuoteRenderer content={{}} />);
    expect(container.querySelector('blockquote')).toBeNull();
  });

  it('renders quote text and attribution', () => {
    render(<QuoteRenderer content={{ text: 'Hello.', attribution: 'World' }} />);
    expect(screen.getByText(/Hello\./)).toBeInTheDocument();
    expect(screen.getByText(/World/)).toBeInTheDocument();
  });

  it('omits footer when no attribution', () => {
    const { container } = render(<QuoteRenderer content={{ text: 'X' }} />);
    expect(container.querySelector('footer')).toBeNull();
  });
});
