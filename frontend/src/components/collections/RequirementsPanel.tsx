/**
 * RequirementsPanel Component
 *
 * Generic presentational component for displaying procedure requirements.
 * Shared by EntryRequirementsCard and ProcedureCompliancePanel via thin wrappers
 * that map their data sources to this common interface.
 *
 * Features: collapsible header with completion stats, progress bar,
 * clickable row checklist, and optional footer with guidance link.
 */

import { useState, useEffect } from 'react';
import {
  ChevronDown,
  ChevronUp,
  CheckCircle,
  AlertCircle,
  Circle,
  ExternalLink,
  Pin,
  PinOff,
} from 'lucide-react';

export interface RequirementsPanelRow {
  id: string;
  label: string;
  completedCount: number;
  totalCount: number;
  /** Has blocking/required incomplete items */
  hasBlocking: boolean;
  /** Label of first blocking or missing item */
  primaryMissing?: string;
}

export interface RequirementsPanelProps {
  /** Card title, e.g. "Entry Requirements", "Loan Requirements" */
  title: string;
  /** Numerator for "X/Y (Z%)" display */
  completedCount: number;
  /** Denominator for "X/Y (Z%)" display */
  totalCount: number;
  /** 0–100 */
  percentComplete: number;
  /** Whether all blocking requirements are met */
  isReady: boolean;
  /** Human-readable "Ready for X" or "Not ready: Y" message */
  statusMessage: string;
  /** Status message color: true = success, false = warning */
  statusIsPositive: boolean;
  /** Clickable rows (groups or sections) */
  rows: RequirementsPanelRow[];
  /** Called when a row is clicked — navigates to that section */
  onRowClick: (rowId: string) => void;
  /** Called when "Fix blocker" is clicked */
  onFixBlocker?: () => void;
  /**
   * Extra slot rendered in the header action area, immediately to the left
   * of the "Fix blocker" button. Used for the "Ask Guide" chip on
   * procedure cards so generic callers (entry requirements, etc.) don't
   * have to know about the Guide.
   */
  headerActionSlot?: React.ReactNode;
  /** Footer help text */
  footerText?: string;
  /** Optional guidance callback (shows "View guidance" link in footer) */
  onViewGuidance?: () => void;
  defaultExpanded?: boolean;
  /** Force expand (used when gating outcome actions) */
  forceExpanded?: boolean;
}

export function RequirementsPanel({
  title,
  completedCount,
  totalCount,
  percentComplete,
  isReady: _isReady,
  statusMessage,
  statusIsPositive,
  rows,
  onRowClick,
  onFixBlocker,
  headerActionSlot,
  footerText = 'Required fields must be completed before advancing to certain statuses.',
  onViewGuidance,
  defaultExpanded = false,
  forceExpanded = false,
}: RequirementsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isPinned, setIsPinned] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('requirements-pinned') === 'true';
  });

  useEffect(() => {
    if (forceExpanded) {
      setIsExpanded(true);
    }
  }, [forceExpanded]);

  const togglePin = () => {
    const next = !isPinned;
    setIsPinned(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem('requirements-pinned', String(next));
    }
  };

  const hasBlockers = !!onFixBlocker;

  return (
    <div
      className={`rounded-lg border border-lichen bg-parchment mb-6 shadow-md ${isPinned ? 'sticky z-20' : ''}`}
      style={isPinned ? { top: 'var(--record-sticky-top, 16px)' } : undefined}
      data-requirements-card
    >
      {/* Header */}
      <div className={`flex items-center justify-between p-4 transition-colors ${isExpanded ? 'bg-stone/40' : 'hover:bg-stone/20 cursor-pointer'}`}>
        <div
          role="button"
          tabIndex={0}
          className="flex-1 min-w-0 text-left cursor-pointer focus-visible:outline-none rounded"
          onClick={() => setIsExpanded(!isExpanded)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsExpanded(!isExpanded);
            }
          }}
          aria-expanded={isExpanded}
          aria-controls="requirements-panel"
        >
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">
              {title}
            </h3>
            {!isExpanded && (
              <span className="text-xs text-archive">— click to expand</span>
            )}
          </div>
          <p className="text-sm text-archive mt-0.5">
            Required fields completed — {completedCount}/{totalCount} ({percentComplete}%)
          </p>
          <p className={`text-sm mt-0.5 font-medium ${statusIsPositive ? 'text-semantic-success' : 'text-semantic-warning'}`}>
            {statusMessage}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {headerActionSlot}
          {onFixBlocker && (
            <button
              type="button"
              onClick={onFixBlocker}
              className="px-3 py-1.5 text-sm font-medium text-semantic-warning bg-semantic-warning/10 border border-semantic-warning/30 rounded-md hover:bg-semantic-warning/20 transition-colors"
            >
              Fix blocker
            </button>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); togglePin(); }}
            className={`p-1 rounded hover:bg-stone/50 focus-visible:outline-none transition-colors ${isPinned ? 'text-bark' : 'text-archive'}`}
            aria-label={isPinned ? 'Unpin requirements (scroll away)' : 'Pin requirements (stick to top)'}
            title={isPinned ? 'Unpin — scroll away with page' : 'Pin — stick to top while scrolling'}
          >
            {isPinned ? <Pin className="h-4 w-4 fill-current" /> : <PinOff className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded hover:bg-stone/50 focus-visible:outline-none"
            aria-label={isExpanded ? 'Collapse requirements' : 'Expand requirements'}
          >
            {isExpanded ? (
              <ChevronUp className="h-5 w-5 text-archive" />
            ) : (
              <ChevronDown className="h-5 w-5 text-archive" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded Panel */}
      {isExpanded && (
        <div id="requirements-panel" className="border-t border-lichen">
          {/* Progress Bar */}
          <div className="px-4 py-3 bg-stone/30">
            <div className="h-2 w-full rounded-full bg-lichen overflow-hidden">
              <div
                className={`h-2 rounded-full transition-all duration-500 ${
                  percentComplete === 100
                    ? 'bg-semantic-success'
                    : hasBlockers
                    ? 'bg-semantic-warning'
                    : 'bg-bark'
                }`}
                style={{ width: `${percentComplete}%` }}
              />
            </div>
          </div>

          {/* Row Checklist */}
          <div className="divide-y divide-lichen">
            {rows.map((row) => (
              <RequirementRow
                key={row.id}
                row={row}
                onClick={() => onRowClick(row.id)}
              />
            ))}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 bg-stone/30 border-t border-lichen">
            <p className="text-xs text-archive mb-2">
              {footerText}
            </p>
            {onViewGuidance && (
              <button
                type="button"
                onClick={onViewGuidance}
                className="flex items-center gap-1 text-xs text-bark hover:text-copper-dark font-medium"
              >
                View guidance
                <ExternalLink className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * RequirementRow — single row in the checklist.
 */
interface RequirementRowProps {
  row: RequirementsPanelRow;
  onClick: () => void;
}

function RequirementRow({ row, onClick }: RequirementRowProps) {
  const { label, completedCount, totalCount, hasBlocking, primaryMissing } = row;

  const isNotRequired = totalCount === 0;
  const isComplete = !isNotRequired && completedCount === totalCount;

  let StatusIcon = CheckCircle;
  let iconColor = 'text-semantic-success';
  let bgColor = '';
  let rowOpacity = '';

  if (isNotRequired) {
    StatusIcon = Circle;
    iconColor = 'text-archive';
    rowOpacity = 'opacity-60';
  } else if (!isComplete) {
    if (hasBlocking) {
      StatusIcon = AlertCircle;
      iconColor = 'text-semantic-warning';
      bgColor = 'bg-semantic-warning/5';
    } else {
      StatusIcon = Circle;
      iconColor = 'text-archive';
    }
  }

  let statusText: React.ReactNode;
  if (isNotRequired) {
    statusText = <span className="text-xs text-archive">Not required</span>;
  } else {
    statusText = (
      <span className={`text-sm font-medium ${isComplete ? 'text-semantic-success' : 'text-bark'}`}>
        {completedCount}/{totalCount}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`w-full flex items-center justify-between px-4 py-3 text-left hover:bg-stone/30 focus-visible:outline-none transition-colors ${bgColor} ${rowOpacity}`}
      onClick={onClick}
      aria-label={`${label}: ${isNotRequired ? 'Not required' : `${completedCount} of ${totalCount} complete`}. ${primaryMissing ? `Missing: ${primaryMissing}` : ''}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <StatusIcon className={`h-5 w-5 flex-shrink-0 ${iconColor}`} />
        <div className="min-w-0">
          <span className="text-sm font-medium text-ink">
            {label}
          </span>
          {!isComplete && !isNotRequired && primaryMissing && (
            <p className={`text-xs mt-0.5 truncate ${hasBlocking ? 'text-semantic-warning' : 'text-archive'}`}>
              {hasBlocking ? 'Blocking: ' : 'Missing: '}
              {primaryMissing}
            </p>
          )}
        </div>
      </div>

      {statusText}
    </button>
  );
}

export default RequirementsPanel;
