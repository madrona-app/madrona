import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MetadataFieldRenderer } from '../../components/records/MetadataFieldRenderer';

describe('MetadataFieldRenderer', () => {
  it('renders text fields with the current value', () => {
    render(
      <MetadataFieldRenderer
        fields={[{ key: 'title', label: 'Title', type: 'text' }]}
        values={{ title: 'My Title' }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByDisplayValue('My Title')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
  });

  it('shows the required indicator when required', () => {
    render(
      <MetadataFieldRenderer
        fields={[{ key: 'x', label: 'X', type: 'text', required: true }]}
        values={{}}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('uses defaultValue when value is missing', () => {
    render(
      <MetadataFieldRenderer
        fields={[{ key: 'x', label: 'X', type: 'text', defaultValue: 'fallback' }]}
        values={{}}
        onChange={() => {}}
      />,
    );
    expect(screen.getByDisplayValue('fallback')).toBeInTheDocument();
  });

  it('typing in a text field calls onChange', () => {
    const onChange = vi.fn();
    render(
      <MetadataFieldRenderer
        fields={[{ key: 'x', label: 'X', type: 'text' }]}
        values={{ x: '' }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByDisplayValue(''), { target: { value: 'foo' } });
    expect(onChange).toHaveBeenCalledWith('x', 'foo');
  });

  it('renders a textarea when type=textarea', () => {
    const { container } = render(
      <MetadataFieldRenderer
        fields={[{ key: 'note', label: 'Note', type: 'textarea' }]}
        values={{}}
        onChange={() => {}}
      />,
    );
    expect(container.querySelector('textarea')).not.toBeNull();
  });

  it('renders a select with the supplied options', () => {
    render(
      <MetadataFieldRenderer
        fields={[
          {
            key: 'kind',
            label: 'Kind',
            type: 'select',
            options: [
              { value: 'a', label: 'Apple' },
              { value: 'b', label: 'Banana' },
            ],
          },
        ]}
        values={{ kind: 'a' }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByDisplayValue('Apple')).toBeInTheDocument();
    expect(screen.getByText('Banana')).toBeInTheDocument();
  });

  it('select onChange fires with the right key', () => {
    const onChange = vi.fn();
    render(
      <MetadataFieldRenderer
        fields={[
          {
            key: 'k',
            label: 'K',
            type: 'select',
            options: [
              { value: 'a', label: 'A' },
              { value: 'b', label: 'B' },
            ],
          },
        ]}
        values={{ k: 'a' }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalledWith('k', 'b');
  });

  it('renders radio-cards with descriptions', () => {
    render(
      <MetadataFieldRenderer
        fields={[
          {
            key: 'mode',
            label: 'Mode',
            type: 'radio-cards',
            options: [
              { value: 'a', label: 'Option A', description: 'Does A' },
              { value: 'b', label: 'Option B', description: 'Does B' },
            ],
          },
        ]}
        values={{ mode: 'a' }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('Option A')).toBeInTheDocument();
    expect(screen.getByText('Does A')).toBeInTheDocument();
    expect(screen.getByText('Option B')).toBeInTheDocument();
  });

  it('clicking a radio card option fires onChange', () => {
    const onChange = vi.fn();
    render(
      <MetadataFieldRenderer
        fields={[
          {
            key: 'm',
            label: 'M',
            type: 'radio-cards',
            options: [
              { value: 'a', label: 'A' },
              { value: 'b', label: 'B' },
            ],
          },
        ]}
        values={{ m: 'a' }}
        onChange={onChange}
      />,
    );
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[1]);
    expect(onChange).toHaveBeenCalledWith('m', 'b');
  });

  it('renders helpText below the field', () => {
    render(
      <MetadataFieldRenderer
        fields={[{ key: 'x', label: 'X', type: 'text', helpText: 'Hint here' }]}
        values={{}}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('Hint here')).toBeInTheDocument();
  });

  it('renders multiple fields in order', () => {
    render(
      <MetadataFieldRenderer
        fields={[
          { key: 'a', label: 'A', type: 'text' },
          { key: 'b', label: 'B', type: 'text' },
        ]}
        values={{ a: '1', b: '2' }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByDisplayValue('1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
  });
});
