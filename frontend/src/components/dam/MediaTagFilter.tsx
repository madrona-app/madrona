import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tag, X, ChevronDown, Loader2 } from 'lucide-react';
import { listTagDefinitions, getTagValues } from '../../lib/api';
import type { MediaTagDefinition } from '../../lib/schemas';

interface TagFilterValue {
  key: string;
  value: string;
  displayName: string;
}

interface MediaTagFilterProps {
  organizationId: string;
  filters: TagFilterValue[];
  onChange: (filters: TagFilterValue[]) => void;
}

interface TagFilterDropdownProps {
  definition: MediaTagDefinition;
  organizationId: string;
  selectedValues: string[];
  onSelect: (value: string) => void;
  onRemove: (value: string) => void;
}

function TagFilterDropdown({
  definition,
  organizationId,
  selectedValues,
  onSelect,
  onRemove,
}: TagFilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data: valuesData, isLoading } = useQuery({
    queryKey: ['tag-values-filter', organizationId, definition.definition_id],
    queryFn: () => getTagValues(organizationId, definition.definition_id, { limit: 100 }),
    enabled: isOpen,
  });

  const values = valuesData?.values || [];
  const filteredValues = search
    ? values.filter((v) => v.toLowerCase().includes(search.toLowerCase()))
    : values;
  const availableValues = filteredValues.filter((v) => !selectedValues.includes(v));

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-2 py-1 border rounded text-sm ${
          selectedValues.length > 0 ? 'bg-bark/10 border-bark/30' : 'bg-parchment'
        }`}
      >
        <Tag size={14} className="text-archive" />
        <span className="max-w-[120px] truncate">
          {selectedValues.length > 0
            ? `${definition.display_name}: ${selectedValues.length}`
            : definition.display_name}
        </span>
        <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 mt-1 w-64 bg-parchment border rounded-lg shadow-lg z-20">
            <div className="p-2 border-b">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${definition.display_name}...`}
                className="w-full px-2 py-1 text-sm border rounded"
                autoFocus
              />
            </div>

            {selectedValues.length > 0 && (
              <div className="p-2 border-b bg-stone/20">
                <p className="text-xs text-archive mb-1">Selected:</p>
                <div className="flex flex-wrap gap-1">
                  {selectedValues.map((value) => (
                    <span
                      key={value}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-azurite/10 text-azurite text-xs rounded"
                    >
                      {value}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemove(value);
                        }}
                        className="hover:text-parchment"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="max-h-48 overflow-y-auto">
              {isLoading ? (
                <div className="p-4 flex items-center justify-center">
                  <Loader2 size={16} className="animate-spin text-archive" />
                </div>
              ) : availableValues.length === 0 ? (
                <div className="p-4 text-center text-sm text-archive">
                  {search ? 'No matching values' : 'No values available'}
                </div>
              ) : (
                <div className="py-1">
                  {availableValues.map((value) => (
                    <button
                      key={value}
                      onClick={() => {
                        onSelect(value);
                        setSearch('');
                      }}
                      className="w-full px-3 py-1.5 text-left text-sm hover:bg-stone truncate"
                    >
                      {value}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function MediaTagFilter({ organizationId, filters, onChange }: MediaTagFilterProps) {
  const { data: definitionsData, isLoading } = useQuery({
    queryKey: ['tag-definitions', organizationId, false],
    queryFn: () => listTagDefinitions(organizationId, { includeInactive: false }),
  });

  const definitions = definitionsData?.definitions || [];

  // Group filters by tag key
  const filtersByKey = new Map<string, string[]>();
  for (const filter of filters) {
    const existing = filtersByKey.get(filter.key) || [];
    filtersByKey.set(filter.key, [...existing, filter.value]);
  }

  const handleSelect = (definition: MediaTagDefinition, value: string) => {
    const newFilter: TagFilterValue = {
      key: definition.tag_key,
      value,
      displayName: definition.display_name,
    };
    onChange([...filters, newFilter]);
  };

  const handleRemove = (key: string, value: string) => {
    onChange(filters.filter((f) => !(f.key === key && f.value === value)));
  };

  const clearAll = () => {
    onChange([]);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-archive">
        <Loader2 size={14} className="animate-spin" />
        <span className="text-sm">Loading filters...</span>
      </div>
    );
  }

  if (definitions.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm text-archive">Filter by tag:</span>
      {definitions.map((def) => (
        <TagFilterDropdown
          key={def.definition_id}
          definition={def}
          organizationId={organizationId}
          selectedValues={filtersByKey.get(def.tag_key) || []}
          onSelect={(value) => handleSelect(def, value)}
          onRemove={(value) => handleRemove(def.tag_key, value)}
        />
      ))}
      {filters.length > 0 && (
        <button onClick={clearAll} className="text-sm text-archive hover:text-ink underline">
          Clear all
        </button>
      )}
    </div>
  );
}

// Helper function to convert filters to query param format
export function formatTagFiltersForQuery(filters: TagFilterValue[]): string[] {
  return filters.map((f) => `${f.key}:${f.value}`);
}
