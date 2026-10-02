import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '../../lib/utils';

interface WorkshopSectionProps {
  id: string;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Number of filled fields / total fields for progress indicator */
  progress?: { filled: number; total: number };
  /** Additional class for the section */
  className?: string;
}

/**
 * A collapsible section for the Object Workshop.
 * Smooth expand/collapse animation with progress indicator.
 */
export function WorkshopSection({
  id,
  title,
  subtitle,
  icon,
  children,
  defaultOpen = true,
  progress,
  className,
}: WorkshopSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);

  // Measure content height for smooth animation
  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [children]);

  const progressPercent = progress ? Math.round((progress.filled / progress.total) * 100) : null;
  const isComplete = progress ? progress.filled === progress.total : false;

  return (
    <section
      id={id}
      className={cn(
        'bg-parchment rounded-lg border border-lichen/60 transition-shadow duration-200',
        isOpen && 'shadow-sm',
        className
      )}
    >
      {/* Section Header */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'w-full flex items-center gap-3 p-5 text-left transition-colors',
          'hover:bg-stone/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:ring-inset',
          isOpen ? 'rounded-t-lg' : 'rounded-lg'
        )}
        aria-expanded={isOpen}
        aria-controls={`${id}-content`}
      >
        {/* Icon */}
        {icon && (
          <span className="text-bark/70 flex-shrink-0">
            {icon}
          </span>
        )}

        {/* Title & Subtitle */}
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-serif font-medium text-forest leading-tight">
            {title}
          </h2>
          {subtitle && (
            <p className="text-sm text-archive mt-0.5 leading-snug">
              {subtitle}
            </p>
          )}
        </div>

        {/* Progress Indicator */}
        {progress && (
          <div className="flex items-center gap-2 mr-2">
            {isComplete ? (
              <span className="flex items-center gap-1.5 text-sm text-semantic-success">
                <Check size={14} className="stroke-[2.5]" />
                <span className="hidden sm:inline">Complete</span>
              </span>
            ) : (
              <>
                {/* Progress bar */}
                <div className="hidden sm:block w-16 h-1.5 bg-stone/50 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-bark/60 rounded-full transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <span className="text-xs text-archive tabular-nums">
                  {progress.filled}/{progress.total}
                </span>
              </>
            )}
          </div>
        )}

        {/* Chevron */}
        <ChevronDown
          size={20}
          className={cn(
            'text-archive transition-transform duration-200 flex-shrink-0',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {/* Section Content */}
      <div
        id={`${id}-content`}
        style={{
          height: isOpen ? contentHeight : 0,
          opacity: isOpen ? 1 : 0,
        }}
        className="overflow-hidden transition-all duration-200 ease-out"
      >
        <div ref={contentRef} className="p-5 pt-0">
          <div className="border-t border-lichen/40 pt-5">
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
