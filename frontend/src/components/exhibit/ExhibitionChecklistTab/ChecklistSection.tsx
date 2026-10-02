import Checkbox from '../../Checkbox';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ChecklistItem, ChecklistItemStatus, ChecklistPhase } from './types';
import { PHASE_CONFIG } from './constants';
import { ChecklistItemRow } from './ChecklistItem';

interface PhaseGroupProps {
  phase: ChecklistPhase;
  items: ChecklistItem[];
  isExpanded: boolean;
  onToggle: () => void;
  onStatusChange: (itemId: string, status: ChecklistItemStatus) => void;
  onItemClick: (item: ChecklistItem) => void;
  selectedItems: Set<string>;
  onToggleSelect: (itemId: string) => void;
  canEdit: boolean;
}

export function PhaseGroup({
  phase,
  items,
  isExpanded,
  onToggle,
  onStatusChange,
  onItemClick,
  selectedItems,
  onToggleSelect,
  canEdit,
}: PhaseGroupProps) {
  const config = PHASE_CONFIG[phase];
  const doneCount = items.filter((i) => i.status === 'done' || i.status === 'not_applicable').length;
  const progress = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;

  // Handle select all in phase
  const allSelected = items.length > 0 && items.every((i) => selectedItems.has(i.item_id));
  const someSelected = items.some((i) => selectedItems.has(i.item_id));

  const handleSelectAll = () => {
    if (allSelected) {
      items.forEach((i) => onToggleSelect(i.item_id));
    } else {
      items.forEach((i) => {
        if (!selectedItems.has(i.item_id)) {
          onToggleSelect(i.item_id);
        }
      });
    }
  };

  return (
    <div className="border border-lichen rounded-lg overflow-hidden">
      {/* Sticky header */}
      <div
        className={`sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-parchment border-b border-lichen cursor-pointer hover:bg-stone/30`}
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown className="w-5 h-5 text-archive" />
          ) : (
            <ChevronRight className="w-5 h-5 text-archive" />
          )}
          <span className={`px-2.5 py-1 text-sm font-medium rounded-full ${config.color}`}>
            {config.label}
          </span>
          <span className="text-sm text-archive">
            {doneCount} of {items.length} complete
          </span>
        </div>
        {/* Progress bar */}
        <div className="flex items-center gap-3">
          <div className="w-24 h-2 bg-lichen rounded-full overflow-hidden">
            <div
              className="h-full bg-semantic-success/100 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-sm font-medium text-ink w-10 text-right">{progress}%</span>
        </div>
      </div>

      {/* Items table */}
      {isExpanded && items.length > 0 && (
        <table className="w-full">
          <thead className="bg-stone/50 text-xs text-archive uppercase tracking-wide">
            <tr>
              <th className="w-10 px-2 py-2">
                <Checkbox
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={handleSelectAll}
                  className="w-4 h-4 rounded border-lichen text-bark focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  aria-label="Select all items in phase"
                />
              </th>
              <th className="w-32 px-2 py-2 text-left">Status</th>
              <th className="px-2 py-2 text-left">Task</th>
              <th className="w-40 px-2 py-2 text-left">Assignee</th>
              <th className="w-28 px-2 py-2 text-left">Due</th>
              <th className="w-20 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <ChecklistItemRow
                key={item.item_id}
                item={item}
                onStatusChange={onStatusChange}
                onItemClick={onItemClick}
                isSelected={selectedItems.has(item.item_id)}
                onToggleSelect={onToggleSelect}
                canEdit={canEdit}
              />
            ))}
          </tbody>
        </table>
      )}

      {isExpanded && items.length === 0 && (
        <div className="px-4 py-6 text-center text-archive">
          No items in this phase
        </div>
      )}
    </div>
  );
}
