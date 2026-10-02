import { Edit2, Trash2, ArrowRight } from 'lucide-react';
import type { MappingRowProps } from './types';

export function MappingRow({ mapping, onEdit, onDelete }: MappingRowProps) {
  return (
    <div className="flex items-center justify-between p-3 bg-parchment border border-lichen rounded-lg hover:border-forest/30 transition-colors">
      <div className="flex items-center gap-3">
        <span className="font-medium text-ink">{mapping.ai_tag_value}</span>
        <ArrowRight size={14} className="text-accessible-gray" />
        <span className="text-forest">
          {mapping.definition_display_name || 'Unknown'}: {mapping.mapped_value}
        </span>
        {mapping.auto_apply && (
          <span className="text-xs px-1.5 py-0.5 bg-semantic-success/10 text-semantic-success rounded">
            Auto
          </span>
        )}
        <span className="text-xs text-accessible-gray">
          {Math.round(Number(mapping.min_confidence) * 100)}% min
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onEdit(mapping)}
          className="p-1.5 text-accessible-gray hover:text-forest hover:bg-forest/5 rounded"
          title="Edit"
        >
          <Edit2 size={14} />
        </button>
        <button
          onClick={() => onDelete(mapping)}
          className="p-1.5 text-accessible-gray hover:text-semantic-error hover:bg-semantic-error/10 rounded"
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
