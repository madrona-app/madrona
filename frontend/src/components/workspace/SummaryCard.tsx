import { memo, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface SummaryCardProps {
  id: string;
  title: string;
  icon?: ReactNode;
  hint?: string;
  isEmpty?: boolean;
  onClick: () => void;
  className?: string;
}

/**
 * Compact summary card for the grid-based workspace layout.
 * Shows icon, title, and a brief hint. Clicking opens a slide-over for editing.
 */
export const SummaryCard = memo(function SummaryCard({
  id,
  title,
  icon,
  hint,
  isEmpty = false,
  onClick,
  className,
}: SummaryCardProps) {
  return (
    <button
      type="button"
      id={`summary-${id}`}
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-lg border transition-all duration-150',
        'px-4 py-3 flex items-center gap-3',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2',
        isEmpty
          ? 'border-lichen/40 bg-parchment hover:border-archive/40 hover:bg-stone/30'
          : 'border-lichen/60 bg-parchment hover:shadow-md hover:-translate-y-0.5 hover:border-archive/40',
        className
      )}
    >
      {icon && (
        <span className={cn('flex-shrink-0', isEmpty ? 'text-archive/50' : 'text-archive')}>
          {icon}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <h3 className={cn(
          'text-sm font-medium truncate',
          isEmpty ? 'text-archive' : 'text-forest'
        )}>
          {title}
        </h3>
        {hint && !isEmpty && (
          <p className="text-xs text-archive mt-0.5 truncate">{hint}</p>
        )}
        {isEmpty && (
          <p className="text-xs text-bark mt-0.5">+ Add</p>
        )}
      </div>
    </button>
  );
});
