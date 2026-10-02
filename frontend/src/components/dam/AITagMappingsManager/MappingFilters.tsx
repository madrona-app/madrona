import { Search } from 'lucide-react';
import { TAG_TYPES } from './types';
import type { MappingFiltersProps } from './types';

export function MappingFilters({
  search,
  onSearchChange,
  filterType,
  onFilterTypeChange,
}: MappingFiltersProps) {
  return (
    <div className="flex items-center gap-4">
      <div className="relative flex-1 max-w-xs">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-accessible-gray" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search mappings..."
          className="w-full pl-9 pr-3 py-2 border border-lichen rounded-md text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        />
      </div>
      <select
        value={filterType}
        onChange={(e) => onFilterTypeChange(e.target.value)}
        className="px-3 py-2 border border-lichen rounded-md text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
      >
        <option value="">All types</option>
        {TAG_TYPES.map((type) => (
          <option key={type.value} value={type.value}>
            {type.label}
          </option>
        ))}
      </select>
    </div>
  );
}
