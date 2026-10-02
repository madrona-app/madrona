import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MappingFilters } from '../../../components/dam/AITagMappingsManager/MappingFilters';

describe('MappingFilters', () => {
  it('renders search input', () => {
    render(
      <MappingFilters search="" onSearchChange={vi.fn()} filterType="" onFilterTypeChange={vi.fn()} />,
    );
    expect(screen.getByPlaceholderText('Search mappings...')).toBeInTheDocument();
  });

  it('reflects current search value', () => {
    render(
      <MappingFilters search="cat" onSearchChange={vi.fn()} filterType="" onFilterTypeChange={vi.fn()} />,
    );
    expect((screen.getByPlaceholderText('Search mappings...') as HTMLInputElement).value).toBe('cat');
  });

  it('calls onSearchChange when typing', () => {
    const onSearchChange = vi.fn();
    render(
      <MappingFilters search="" onSearchChange={onSearchChange} filterType="" onFilterTypeChange={vi.fn()} />,
    );
    fireEvent.change(screen.getByPlaceholderText('Search mappings...'), { target: { value: 'dog' } });
    expect(onSearchChange).toHaveBeenCalledWith('dog');
  });

  it('renders all type options', () => {
    render(
      <MappingFilters search="" onSearchChange={vi.fn()} filterType="" onFilterTypeChange={vi.fn()} />,
    );
    expect(screen.getByText('All types')).toBeInTheDocument();
    expect(screen.getByText('Labels')).toBeInTheDocument();
    expect(screen.getByText('Faces')).toBeInTheDocument();
    expect(screen.getByText('Celebrities')).toBeInTheDocument();
  });

  it('reflects current filterType value', () => {
    render(
      <MappingFilters search="" onSearchChange={vi.fn()} filterType="celebrity" onFilterTypeChange={vi.fn()} />,
    );
    const select = screen.getByDisplayValue('Celebrities') as HTMLSelectElement;
    expect(select.value).toBe('celebrity');
  });

  it('calls onFilterTypeChange when filter selected', () => {
    const onFilterTypeChange = vi.fn();
    render(
      <MappingFilters search="" onSearchChange={vi.fn()} filterType="" onFilterTypeChange={onFilterTypeChange} />,
    );
    fireEvent.change(screen.getByDisplayValue('All types'), { target: { value: 'face' } });
    expect(onFilterTypeChange).toHaveBeenCalledWith('face');
  });

  it('renders 6 type options plus All types', () => {
    const { container } = render(
      <MappingFilters search="" onSearchChange={vi.fn()} filterType="" onFilterTypeChange={vi.fn()} />,
    );
    const options = container.querySelectorAll('option');
    expect(options).toHaveLength(7);
  });
});
