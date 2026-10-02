import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ChecklistItemStatus } from './types';
import { STATUS_CONFIG } from './constants';

interface StatusDropdownProps {
  currentStatus: ChecklistItemStatus;
  onStatusChange: (status: ChecklistItemStatus) => void;
  disabled?: boolean;
}

export function StatusDropdown({ currentStatus, onStatusChange, disabled }: StatusDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const config = STATUS_CONFIG[currentStatus];
  const StatusIcon = config.icon;

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-full ${config.bgColor} ${config.color} ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80 cursor-pointer'
        }`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <StatusIcon className="w-3.5 h-3.5" />
        {config.label}
        {!disabled && <ChevronDown className="w-3 h-3 ml-0.5" />}
      </button>
      {isOpen && (
        <div className="absolute z-20 mt-1 w-40 bg-parchment border border-lichen rounded-lg shadow-lg py-1">
          {Object.entries(STATUS_CONFIG).map(([status, cfg]) => {
            const Icon = cfg.icon;
            return (
              <button
                key={status}
                onClick={() => {
                  onStatusChange(status as ChecklistItemStatus);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-stone ${
                  status === currentStatus ? 'bg-stone/50' : ''
                }`}
              >
                <Icon className={`w-4 h-4 ${cfg.color}`} />
                {cfg.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
