import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  TestimonialEditor,
  TestimonialRenderer,
} from '../../../pages/content/components/blocks/TestimonialBlock';

describe('TestimonialEditor', () => {
  it('shows empty placeholder when no items', () => {
    render(<TestimonialEditor content={{}} onChange={vi.fn()} />);
    expect(screen.getByText(/No testimonials yet/i)).toBeInTheDocument();
  });

  it('adds a testimonial item', () => {
    const onChange = vi.fn();
    render(<TestimonialEditor content={{ items: [] }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Add Testimonial/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          {
            quote: '',
            attribution: '',
            source_url: '',
            logo_media_id: '',
          },
        ],
      }),
    );
  });

  it('updates testimonial quote text', () => {
    const onChange = vi.fn();
    render(
      <TestimonialEditor
        content={{
          items: [{ quote: '', attribution: '', source_url: '', logo_media_id: '' }],
        }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Testimonial quote/i), {
      target: { value: 'Wonderful museum!' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({ quote: 'Wonderful museum!' }),
        ],
      }),
    );
  });
});

describe('TestimonialRenderer', () => {
  it('renders nothing for empty items', () => {
    const { container } = render(
      <TestimonialRenderer content={{ items: [] }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders quote text and attribution', () => {
    render(
      <TestimonialRenderer
        content={{
          items: [
            {
              quote: 'Best place in town',
              attribution: 'Jane Doe',
              source_url: '',
              logo_media_id: '',
            },
          ],
        }}
      />,
    );
    expect(screen.getByText(/Best place in town/)).toBeInTheDocument();
    expect(screen.getByText(/Jane Doe/)).toBeInTheDocument();
  });

  it('renders attribution as link when source_url is set', () => {
    render(
      <TestimonialRenderer
        content={{
          items: [
            {
              quote: 'X',
              attribution: 'Reviewer',
              source_url: 'https://x.com/y',
              logo_media_id: '',
            },
          ],
        }}
      />,
    );
    const link = screen.getByRole('link', { name: 'Reviewer' });
    expect(link).toHaveAttribute('href', 'https://x.com/y');
  });
});
