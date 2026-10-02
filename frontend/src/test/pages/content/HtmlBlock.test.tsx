import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  HtmlEditor,
  HtmlRenderer,
} from '../../../pages/content/components/blocks/HtmlBlock';

vi.mock('../../../lib/sanitize', () => ({
  sanitizeRichHtml: (s: string) => s,
}));

describe('HtmlEditor', () => {
  it('renders the warning banner about sanitization', () => {
    render(<HtmlEditor content={{}} onChange={vi.fn()} />);
    expect(
      screen.getByText(/rendered without sanitization/i),
    ).toBeInTheDocument();
  });

  it('shows existing code value', () => {
    render(
      <HtmlEditor content={{ code: '<p>x</p>' }} onChange={vi.fn()} />,
    );
    expect(
      (screen.getByPlaceholderText(/<div>Your HTML here/i) as HTMLTextAreaElement).value,
    ).toBe('<p>x</p>');
  });

  it('emits new code on change', () => {
    const onChange = vi.fn();
    render(<HtmlEditor content={{}} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/<div>Your HTML here/i), {
      target: { value: '<b>hi</b>' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ code: '<b>hi</b>' }),
    );
  });
});

describe('HtmlRenderer', () => {
  it('renders nothing when code is empty', () => {
    const { container } = render(<HtmlRenderer content={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders sanitized html when provided', () => {
    const { container } = render(
      <HtmlRenderer content={{ code: '<p data-x>hi</p>' }} />,
    );
    expect(container.querySelector('p')?.textContent).toBe('hi');
  });
});
