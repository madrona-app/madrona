import { memo } from 'react';
import Checkbox from '../../Checkbox';
import { Calendar, User, Link2, FileText } from 'lucide-react';
import { formatDateShort } from '../../../lib/formatters';
import type { ChecklistItem as ChecklistItemType, ChecklistItemStatus } from './types';
import { ROLE_LABELS } from './constants';
import { StatusDropdown } from './StatusDropdown';

interface ChecklistItemRowProps {
  item: ChecklistItemType;
  onStatusChange: (itemId: string, status: ChecklistItemStatus) => void;
  onItemClick: (item: ChecklistItemType) => void;
  isSelected: boolean;
  onToggleSelect: (itemId: string) => void;
  canEdit: boolean;
}

export const ChecklistItemRow = memo(function ChecklistItemRow({
  item,
  onStatusChange,
  onItemClick,
  isSelected,
  onToggleSelect,
  canEdit,
}: ChecklistItemRowProps) {
  const isOverdue = item.due_date && new Date(item.due_date) < new Date() && item.status !== 'done' && item.status !== 'not_applicable';

  return (
    <tr
      className={`border-b border-lichen/50 hover:bg-stone/30 ${isSelected ? 'bg-bark/5' : ''}`}
    >
      {/* Checkbox */}
      <td className="w-10 px-2 py-3">
        <Checkbox
          checked={isSelected}
          onChange={() => onToggleSelect(item.item_id)}
          aria-label={`Select ${item.title}`}
        />
      </td>

      {/* Status */}
      <td className="w-32 px-2 py-3">
        <StatusDropdown
          currentStatus={item.status}
          onStatusChange={(status) => onStatusChange(item.item_id, status)}
          disabled={!canEdit}
        />
      </td>

      {/* Title + Description preview */}
      <td className="px-2 py-3">
        <button
          onClick={() => onItemClick(item)}
          className="text-left w-full group"
        >
          <div className="font-medium text-ink group-hover:text-bark">
            {item.title}
          </div>
          {item.description && (
            <div className="text-sm text-archive truncate max-w-md">
              {item.description}
            </div>
          )}
        </button>
      </td>

      {/* Role / Assignee */}
      <td className="w-40 px-2 py-3 text-sm text-ink/70">
        <div className="flex items-center gap-1.5">
          <User className="w-3.5 h-3.5 text-archive" />
          {item.assigned_user_name || ROLE_LABELS[item.responsible_role]}
        </div>
      </td>

      {/* Due Date */}
      <td className={`w-28 px-2 py-3 text-sm ${isOverdue ? 'text-semantic-error font-medium' : 'text-ink/70'}`}>
        {item.due_date ? (
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            {formatDateShort(item.due_date)}
          </div>
        ) : (
          <span className="text-archive">-</span>
        )}
      </td>

      {/* Indicators */}
      <td className="w-20 px-2 py-3">
        <div className="flex items-center gap-2">
          {item.links_count > 0 && (
            <span className="inline-flex items-center gap-0.5 text-xs text-archive" title={`${item.links_count} linked items`}>
              <Link2 className="w-3.5 h-3.5" />
              {item.links_count}
            </span>
          )}
          {item.notes && (
            <span title="Has notes">
              <FileText className="w-3.5 h-3.5 text-archive" />
            </span>
          )}
        </div>
      </td>
    </tr>
  );
});
