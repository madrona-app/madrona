import { Plus, Tag } from 'lucide-react';
import { TAG_TYPES } from './types';
import { MappingRow } from './MappingRow';
import type { MappingsListProps } from './types';

export function MappingsList({
  mappingsByType,
  isEmpty,
  onCreate,
  onEdit,
  onDelete,
}: MappingsListProps) {
  if (isEmpty) {
    return (
      <div className="text-center py-12 border border-dashed border-lichen rounded-lg">
        <Tag size={32} className="mx-auto text-accessible-gray mb-3" />
        <h3 className="text-lg font-medium text-ink mb-2">No mappings yet</h3>
        <p className="text-accessible-gray mb-4">
          Create mappings to automatically convert AI-detected tags to your organization's tags
        </p>
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-2 px-4 py-2 bg-forest text-parchment rounded-md hover:bg-forest/90"
        >
          <Plus size={16} />
          Create First Mapping
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {TAG_TYPES.filter((type) => mappingsByType[type.value]?.length > 0).map((type) => {
        const Icon = type.icon;
        const typeMappings = mappingsByType[type.value] || [];

        return (
          <div key={type.value}>
            <h4 className="flex items-center gap-2 text-sm font-medium text-ink mb-3">
              <Icon size={16} className={type.color} />
              {type.label}
              <span className="text-accessible-gray font-normal">({typeMappings.length})</span>
            </h4>
            <div className="space-y-2">
              {typeMappings.map((mapping) => (
                <MappingRow
                  key={mapping.mapping_id}
                  mapping={mapping}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
