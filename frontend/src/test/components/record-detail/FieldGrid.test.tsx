import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  FieldGrid,
  FieldValue,
  IDENTIFICATION_FIELDS,
  PHYSICAL_DESCRIPTION_FIELDS,
  type FieldDefinition,
} from '../../../components/record-detail/FieldGrid';

vi.mock('../../../lib/formatters', () => ({
  formatDateLong: (s: string) => `dateLong:${s}`,
  formatNumber: (n: number) => `num:${n}`,
}));

describe('FieldValue', () => {
  it('renders a placeholder when the value is null', () => {
    const field: FieldDefinition = { key: 'k', label: 'L', type: 'text' };
    render(<FieldValue field={field} value={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders the custom emptyText when provided', () => {
    const field: FieldDefinition = { key: 'k', label: 'L', type: 'text', emptyText: 'Not set' };
    render(<FieldValue field={field} value="" />);
    expect(screen.getByText('Not set')).toBeInTheDocument();
  });

  it('uses the formatter for date fields', () => {
    const field: FieldDefinition = { key: 'd', label: 'Date', type: 'date' };
    render(<FieldValue field={field} value="2026-01-15" />);
    expect(screen.getByText('dateLong:2026-01-15')).toBeInTheDocument();
  });

  it('uses the formatter for number fields', () => {
    const field: FieldDefinition = { key: 'n', label: 'Num', type: 'number' };
    render(<FieldValue field={field} value={1234} />);
    expect(screen.getByText('num:1234')).toBeInTheDocument();
  });

  it('renders an http link as an anchor tag', () => {
    const field: FieldDefinition = { key: 'u', label: 'URL', type: 'link' };
    render(<FieldValue field={field} value="https://example.com" />);
    const link = screen.getByText('https://example.com');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', 'https://example.com');
  });

  it('renders a badge for badge fields', () => {
    const field: FieldDefinition = { key: 'b', label: 'B', type: 'badge' };
    render(<FieldValue field={field} value="DRAFT" />);
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
  });

  it('joins arrays with commas for text/custom fields', () => {
    const field: FieldDefinition = { key: 'a', label: 'A', type: 'text' };
    render(<FieldValue field={field} value={['x', 'y', 'z']} />);
    expect(screen.getByText('x, y, z')).toBeInTheDocument();
  });

  it('uses object.name when value is an object', () => {
    const field: FieldDefinition = { key: 'o', label: 'O', type: 'text' };
    render(<FieldValue field={field} value={{ name: 'Henry', extra: 1 }} />);
    expect(screen.getByText('Henry')).toBeInTheDocument();
  });

  it('returns the placeholder when render returns null', () => {
    const field: FieldDefinition = {
      key: 'c',
      label: 'C',
      type: 'custom',
      render: () => null,
    };
    render(<FieldValue field={field} value="anything" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders a custom render function', () => {
    const field: FieldDefinition = {
      key: 'c',
      label: 'C',
      type: 'custom',
      render: (v) => <strong>got:{String(v)}</strong>,
    };
    render(<FieldValue field={field} value="hello" />);
    expect(screen.getByText('got:hello')).toBeInTheDocument();
  });
});

describe('FieldGrid', () => {
  const fields: FieldDefinition[] = [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'age', label: 'Age', type: 'number' },
    { key: 'bio', label: 'Bio', type: 'longtext' },
  ];

  it('renders all field labels', () => {
    render(<FieldGrid fields={fields} data={{ name: 'Ada', age: 30, bio: 'Mathematician' }} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Age')).toBeInTheDocument();
    expect(screen.getByText('Bio')).toBeInTheDocument();
  });

  it('renders the values', () => {
    render(<FieldGrid fields={fields} data={{ name: 'Ada', age: 30, bio: 'Mathematician' }} />);
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Mathematician')).toBeInTheDocument();
  });

  it('hides fields with hideWhenEmpty when their value is missing', () => {
    const f: FieldDefinition[] = [
      { key: 'a', label: 'A', type: 'text' },
      { key: 'b', label: 'B', type: 'text', hideWhenEmpty: true },
    ];
    render(<FieldGrid fields={f} data={{ a: 'x' }} />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.queryByText('B')).not.toBeInTheDocument();
  });

  it('renders fields with hideWhenEmpty when their value is set', () => {
    const f: FieldDefinition[] = [
      { key: 'b', label: 'B', type: 'text', hideWhenEmpty: true },
    ];
    render(<FieldGrid fields={f} data={{ b: 'visible' }} />);
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('visible')).toBeInTheDocument();
  });

  it('exports prebuilt field definitions', () => {
    expect(IDENTIFICATION_FIELDS.length).toBeGreaterThan(0);
    expect(PHYSICAL_DESCRIPTION_FIELDS.length).toBeGreaterThan(0);
    expect(IDENTIFICATION_FIELDS.find((f) => f.key === 'object_number')).toBeDefined();
  });
});
