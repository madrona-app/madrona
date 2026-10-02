import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MappingsList } from '../../../components/dam/AITagMappingsManager/MappingsList';

const mappingsByType = {
  label: [
    {
      mapping_id: 'm-1',
      ai_tag_type: 'label',
      ai_tag_value: 'cat',
      definition_display_name: 'Subject',
      mapped_value: 'feline',
      auto_apply: false,
      min_confidence: 0.8,
    },
    {
      mapping_id: 'm-2',
      ai_tag_type: 'label',
      ai_tag_value: 'dog',
      definition_display_name: 'Subject',
      mapped_value: 'canine',
      auto_apply: true,
      min_confidence: 0.9,
    },
  ],
  face: [
    {
      mapping_id: 'm-3',
      ai_tag_type: 'face',
      ai_tag_value: 'person',
      definition_display_name: 'People',
      mapped_value: 'human',
      auto_apply: false,
      min_confidence: 0.7,
    },
  ],
} as never;

describe('MappingsList', () => {
  it('renders empty state when isEmpty=true', () => {
    render(<MappingsList mappingsByType={{}} isEmpty onCreate={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('No mappings yet')).toBeInTheDocument();
    expect(screen.getByText('Create First Mapping')).toBeInTheDocument();
  });

  it('calls onCreate when Create First Mapping clicked', () => {
    const onCreate = vi.fn();
    render(<MappingsList mappingsByType={{}} isEmpty onCreate={onCreate} onEdit={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByText('Create First Mapping'));
    expect(onCreate).toHaveBeenCalled();
  });

  it('renders type sections with counts', () => {
    render(<MappingsList mappingsByType={mappingsByType} isEmpty={false} onCreate={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Labels')).toBeInTheDocument();
    expect(screen.getByText('Faces')).toBeInTheDocument();
    expect(screen.getByText('(2)')).toBeInTheDocument();
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });

  it('renders mapping rows', () => {
    render(<MappingsList mappingsByType={mappingsByType} isEmpty={false} onCreate={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('cat')).toBeInTheDocument();
    expect(screen.getByText('dog')).toBeInTheDocument();
    expect(screen.getByText('person')).toBeInTheDocument();
  });

  it('skips type sections with no mappings', () => {
    render(<MappingsList mappingsByType={{ label: mappingsByType.label }} isEmpty={false} onCreate={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByText('Faces')).not.toBeInTheDocument();
  });

  it('passes onEdit through to rows', () => {
    const onEdit = vi.fn();
    render(<MappingsList mappingsByType={mappingsByType} isEmpty={false} onCreate={vi.fn()} onEdit={onEdit} onDelete={vi.fn()} />);
    const editButtons = screen.getAllByTitle('Edit');
    fireEvent.click(editButtons[0]);
    expect(onEdit).toHaveBeenCalled();
  });

  it('passes onDelete through to rows', () => {
    const onDelete = vi.fn();
    render(<MappingsList mappingsByType={mappingsByType} isEmpty={false} onCreate={vi.fn()} onEdit={vi.fn()} onDelete={onDelete} />);
    const deleteButtons = screen.getAllByTitle('Delete');
    fireEvent.click(deleteButtons[0]);
    expect(onDelete).toHaveBeenCalled();
  });
});
