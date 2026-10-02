import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MappingRow } from '../../../components/dam/AITagMappingsManager/MappingRow';

const baseMapping = {
  mapping_id: 'm-1',
  ai_tag_type: 'label',
  ai_tag_value: 'cat',
  definition_id: 'd-1',
  definition_display_name: 'Subject',
  mapped_value: 'feline',
  auto_apply: true,
  min_confidence: 0.85,
} as never;

describe('MappingRow', () => {
  it('renders ai tag value, mapped value, and definition', () => {
    render(<MappingRow mapping={baseMapping} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('cat')).toBeInTheDocument();
    expect(screen.getByText('Subject: feline')).toBeInTheDocument();
  });

  it('shows Auto badge when auto_apply=true', () => {
    render(<MappingRow mapping={baseMapping} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Auto')).toBeInTheDocument();
  });

  it('hides Auto badge when auto_apply=false', () => {
    render(
      <MappingRow mapping={{ ...baseMapping, auto_apply: false }} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.queryByText('Auto')).not.toBeInTheDocument();
  });

  it('formats min_confidence as percent', () => {
    render(<MappingRow mapping={baseMapping} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('85% min')).toBeInTheDocument();
  });

  it('shows "Unknown" when definition_display_name is missing', () => {
    render(
      <MappingRow
        mapping={{ ...baseMapping, definition_display_name: null }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Unknown: feline')).toBeInTheDocument();
  });

  it('calls onEdit with mapping when Edit clicked', () => {
    const onEdit = vi.fn();
    render(<MappingRow mapping={baseMapping} onEdit={onEdit} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Edit'));
    expect(onEdit).toHaveBeenCalledWith(baseMapping);
  });

  it('calls onDelete with mapping when Delete clicked', () => {
    const onDelete = vi.fn();
    render(<MappingRow mapping={baseMapping} onEdit={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByTitle('Delete'));
    expect(onDelete).toHaveBeenCalledWith(baseMapping);
  });

  it('handles 0% confidence value', () => {
    render(
      <MappingRow mapping={{ ...baseMapping, min_confidence: 0 }} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByText('0% min')).toBeInTheDocument();
  });
});
