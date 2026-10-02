import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  AccordionEditor,
  AccordionRenderer,
} from '../../../pages/content/components/blocks/AccordionBlock';

describe('AccordionEditor', () => {
  it('shows empty hint when no items', () => {
    render(<AccordionEditor content={{}} onChange={vi.fn()} />);
    expect(screen.getByText(/No items yet/i)).toBeInTheDocument();
  });

  it('adds an item', () => {
    const onChange = vi.fn();
    render(<AccordionEditor content={{ items: [] }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Add Item/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ title: '', body: '' }],
      }),
    );
  });

  it('updates an item title', () => {
    const onChange = vi.fn();
    render(
      <AccordionEditor
        content={{ items: [{ title: 'orig', body: 'b' }] }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('Section title'), {
      target: { value: 'Updated' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ title: 'Updated', body: 'b' }],
      }),
    );
  });

  it('removes an item', () => {
    const onChange = vi.fn();
    render(
      <AccordionEditor
        content={{ items: [{ title: 'A', body: 'a' }] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTitle('Remove item'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ items: [] }),
    );
  });
});

describe('AccordionRenderer', () => {
  it('renders nothing for empty items', () => {
    const { container } = render(
      <AccordionRenderer content={{ items: [] }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders item titles', () => {
    render(
      <AccordionRenderer
        content={{
          items: [
            { title: 'Hours', body: '9-5' },
            { title: 'Address', body: 'NYC' },
          ],
        }}
      />,
    );
    expect(screen.getByText('Hours')).toBeInTheDocument();
    expect(screen.getByText('Address')).toBeInTheDocument();
  });

  it('expands content when title is clicked', () => {
    render(
      <AccordionRenderer
        content={{ items: [{ title: 'Hours', body: '9 to 5' }] }}
      />,
    );
    expect(screen.queryByText('9 to 5')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hours' }));
    expect(screen.getByText('9 to 5')).toBeInTheDocument();
  });
});
