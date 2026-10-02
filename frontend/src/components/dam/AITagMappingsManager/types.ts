import type { LucideIcon } from 'lucide-react';
import { Tag, Type, User, Star, Shield, Palette } from 'lucide-react';
import type { MediaAITagMapping } from '../../../lib/api';
import type { MediaTagDefinition } from '../../../lib/schemas';

export type AITagType = 'label' | 'text' | 'face' | 'celebrity' | 'moderation' | 'color';

export interface TagTypeConfig {
  value: string;
  label: string;
  icon: LucideIcon;
  color: string;
}

export const TAG_TYPES: TagTypeConfig[] = [
  { value: 'label', label: 'Labels', icon: Tag, color: 'text-semantic-info' },
  { value: 'text', label: 'Text', icon: Type, color: 'text-semantic-success' },
  { value: 'face', label: 'Faces', icon: User, color: 'text-archive' },
  { value: 'celebrity', label: 'Celebrities', icon: Star, color: 'text-semantic-warning' },
  { value: 'moderation', label: 'Moderation', icon: Shield, color: 'text-semantic-error' },
  { value: 'color', label: 'Colors', icon: Palette, color: 'text-bark' },
];

export interface AITagMappingsManagerProps {
  organizationId: string;
}

export interface MappingEditorProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
  mapping?: MediaAITagMapping | null;
  tagDefinitions: MediaTagDefinition[];
}

export interface MappingFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  filterType: string;
  onFilterTypeChange: (value: string) => void;
}

export interface MappingsListProps {
  mappingsByType: Record<string, MediaAITagMapping[]>;
  isEmpty: boolean;
  onCreate: () => void;
  onEdit: (mapping: MediaAITagMapping) => void;
  onDelete: (mapping: MediaAITagMapping) => void;
}

export interface MappingRowProps {
  mapping: MediaAITagMapping;
  onEdit: (mapping: MediaAITagMapping) => void;
  onDelete: (mapping: MediaAITagMapping) => void;
}
