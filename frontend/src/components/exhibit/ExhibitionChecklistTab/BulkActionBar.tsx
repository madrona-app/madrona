import { Check, Calendar } from 'lucide-react';

interface BulkActionBarProps {
  selectedCount: number;
  onMarkDone: () => void;
  onSetDueDate: () => void;
  onClearSelection: () => void;
}

export function BulkActionBar({ selectedCount, onMarkDone, onSetDueDate, onClearSelection }: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-30 bg-ink text-parchment rounded-lg shadow-lg px-4 py-3 flex items-center gap-4">
      <span className="text-sm font-medium">{selectedCount} selected</span>
      <div className="h-4 w-px bg-parchment/30" />
      <button
        onClick={onMarkDone}
        className="flex items-center gap-1.5 text-sm hover:text-semantic-success transition-colors"
      >
        <Check className="w-4 h-4" />
        Mark Done
      </button>
      <button
        onClick={onSetDueDate}
        className="flex items-center gap-1.5 text-sm hover:text-semantic-info transition-colors"
      >
        <Calendar className="w-4 h-4" />
        Set Due Date
      </button>
      <div className="h-4 w-px bg-parchment/30" />
      <button
        onClick={onClearSelection}
        className="text-sm text-parchment/70 hover:text-parchment transition-colors"
      >
        Clear
      </button>
    </div>
  );
}
