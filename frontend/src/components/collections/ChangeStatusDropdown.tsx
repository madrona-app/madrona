import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

interface StatusOption {
  key: string;
  label: string;
}

interface StatusConfig {
  label: string;
  color: string;
  icon: LucideIcon;
}

interface ChangeStatusDropdownProps {
  currentStatus: string;
  allStatuses: StatusOption[];
  statusConfig: Record<string, StatusConfig>;
  onStatusChange: (targetStatus: string) => void;
  isPending: boolean;
  /** Status keys that should be styled as destructive (e.g. cancelled, declined, rejected) */
  sideStatuses?: string[];
}

export function ChangeStatusDropdown({
  currentStatus,
  allStatuses,
  statusConfig,
  onStatusChange,
  isPending,
  sideStatuses = [],
}: ChangeStatusDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const sideSet = new Set(sideStatuses);
  const options = allStatuses.filter(s => s.key !== currentStatus);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="btn btn-secondary text-sm inline-flex items-center gap-1.5"
        disabled={isPending}
      >
        Change Status
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 rounded-lg border border-lichen bg-parchment shadow-lg z-50 py-1">
          {options.map((s) => {
            const config = statusConfig[s.key];
            const isSide = sideSet.has(s.key);
            return (
              <button
                key={s.key}
                onClick={() => {
                  onStatusChange(s.key);
                  setOpen(false);
                }}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm hover:bg-stone/50 flex items-center gap-2',
                  isSide && 'text-semantic-error',
                )}
                disabled={isPending}
              >
                {config && (() => { const I = config.icon; return <I size={14} />; })()}
                {s.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
