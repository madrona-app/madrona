import { memo } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SectionGroupDividerProps {
  label: string;
  icon?: LucideIcon;
  className?: string;
}

/**
 * Lightweight visual separator between section groups in the center column.
 * Mirrors the SectionNav's grouping structure.
 */
export const SectionGroupDivider = memo(function SectionGroupDivider({
  label,
  icon: Icon,
  className,
}: SectionGroupDividerProps) {
  return (
    <div className={cn('flex items-center gap-2 pt-6 pb-2', className)} role="separator">
      {Icon && <Icon size={14} className="text-archive flex-shrink-0" />}
      <span className="text-xs font-medium uppercase tracking-wider text-archive">
        {label}
      </span>
      <div className="flex-1 border-t border-lichen/60" />
    </div>
  );
});
