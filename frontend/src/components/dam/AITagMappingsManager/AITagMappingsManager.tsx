import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import {
  getMediaAITagMappings,
  deleteMediaAITagMapping,
  listTagDefinitions,
} from '../../../lib/api';
import type { MediaAITagMapping } from '../../../lib/api';
import ConfirmDialog from '../../ConfirmDialog';
import { MappingEditor } from './MappingEditor';
import { MappingFilters } from './MappingFilters';
import { MappingsList } from './MappingsList';
import type { AITagMappingsManagerProps } from './types';
import { MadronaLoader } from '../../ui/MadronaLoader';

/**
 * AI Tag Mappings Manager
 *
 * Allows users to create mappings between AI-detected labels
 * and organization tag definitions.
 */
export function AITagMappingsManager({ organizationId }: AITagMappingsManagerProps) {
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('');
  const [showEditor, setShowEditor] = useState(false);
  const [editingMapping, setEditingMapping] = useState<MediaAITagMapping | null>(null);
  const [deleteMapping, setDeleteMapping] = useState<MediaAITagMapping | null>(null);

  const { data: mappingsData, isLoading: mappingsLoading } = useQuery({
    queryKey: ['ai-tag-mappings', organizationId, filterType],
    queryFn: () => getMediaAITagMappings(organizationId, { ai_tag_type: filterType || undefined }),
    enabled: !!organizationId,
  });

  const { data: definitionsData } = useQuery({
    queryKey: ['tag-definitions', organizationId],
    queryFn: () => listTagDefinitions(organizationId),
    enabled: !!organizationId,
  });

  const deleteMutation = useMutation({
    mutationFn: (mappingId: string) => deleteMediaAITagMapping(organizationId, mappingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-tag-mappings', organizationId] });
      setDeleteMapping(null);
    },
  });

  const mappings = mappingsData?.mappings || [];
  const definitions = definitionsData?.definitions || [];

  const filteredMappings = useMemo(() => {
    if (!search) return mappings;
    const lower = search.toLowerCase();
    return mappings.filter(
      (m) =>
        m.ai_tag_value.toLowerCase().includes(lower) ||
        m.mapped_value.toLowerCase().includes(lower) ||
        m.definition_display_name?.toLowerCase().includes(lower)
    );
  }, [mappings, search]);

  const mappingsByType = useMemo(() => {
    return filteredMappings.reduce(
      (acc, mapping) => {
        const type = mapping.ai_tag_type;
        if (!acc[type]) acc[type] = [];
        acc[type].push(mapping);
        return acc;
      },
      {} as Record<string, MediaAITagMapping[]>
    );
  }, [filteredMappings]);

  const handleEdit = (mapping: MediaAITagMapping) => {
    setEditingMapping(mapping);
    setShowEditor(true);
  };

  const handleCreate = () => {
    setEditingMapping(null);
    setShowEditor(true);
  };

  if (mappingsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <MadronaLoader variant="dots" />
        <span className="ml-2 text-accessible-gray">Loading mappings...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-ink">AI Tag Mappings</h3>
          <p className="text-sm text-accessible-gray">
            Map AI-detected labels to your organization&apos;s tag definitions
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 px-4 py-2 bg-forest text-parchment rounded-md hover:bg-forest/90"
        >
          <Plus size={16} />
          New Mapping
        </button>
      </div>

      <MappingFilters
        search={search}
        onSearchChange={setSearch}
        filterType={filterType}
        onFilterTypeChange={setFilterType}
      />

      <MappingsList
        mappingsByType={mappingsByType}
        isEmpty={filteredMappings.length === 0}
        onCreate={handleCreate}
        onEdit={handleEdit}
        onDelete={setDeleteMapping}
      />

      <MappingEditor
        isOpen={showEditor}
        onClose={() => {
          setShowEditor(false);
          setEditingMapping(null);
        }}
        organizationId={organizationId}
        mapping={editingMapping}
        tagDefinitions={definitions}
      />

      <ConfirmDialog
        isOpen={!!deleteMapping}
        onClose={() => setDeleteMapping(null)}
        onConfirm={() => deleteMapping && deleteMutation.mutate(deleteMapping.mapping_id)}
        title="Delete Mapping"
        message={`Are you sure you want to delete the mapping for "${deleteMapping?.ai_tag_value}"? This won't affect existing tags.`}
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}
