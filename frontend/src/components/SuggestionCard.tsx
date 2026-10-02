/**
 * Suggestion card component for Staff AI Assistance.
 * 
 * Displays a suggestion with side-by-side comparison (when applicable),
 * actions (Apply, Copy, Dismiss), and collapsible provenance.
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Check, X } from 'lucide-react';
import type { Suggestion } from '../types/assistance';
import { formatRelativeTime } from '../lib/utils';

interface SuggestionCardProps {
  suggestion: Suggestion;
  onApply: () => void;
  onDismiss: () => void;
  onCopy?: () => void;
}

export function SuggestionCard({ suggestion, onApply, onDismiss, onCopy }: SuggestionCardProps) {
  const [showProvenance, setShowProvenance] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const textToCopy = suggestion.proposedValue || suggestion.proposedList?.join(', ') || '';
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onCopy?.();
  };

  const isFieldSuggestion = suggestion.type === 'summary';
  const isListSuggestion = suggestion.type === 'subject_terms';

  return (
    <div className="border border-lichen rounded bg-stone p-4">
      {/* Side-by-side comparison for field suggestions */}
      {isFieldSuggestion && (
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <span className="block text-xs font-medium text-ink mb-2">
              Current
            </span>
            <div className="bg-parchment border border-lichen rounded p-3 text-sm text-accessible-gray min-h-[80px]">
              {suggestion.currentValue || <span className="text-archive italic">None</span>}
            </div>
          </div>
          <div>
            <span className="block text-xs font-medium text-ink mb-2">
              Proposed
            </span>
            <div className="bg-parchment border border-lichen rounded p-3 text-sm text-ink min-h-[80px]">
              {suggestion.proposedValue}
            </div>
          </div>
        </div>
      )}

      {/* List display for term suggestions */}
      {isListSuggestion && suggestion.proposedList && (
        <div className="mb-4">
          <span className="block text-xs font-medium text-ink mb-2">
            Proposed terms
          </span>
          <div className="bg-parchment border border-lichen rounded p-3">
            <ul className="space-y-1">
              {suggestion.proposedList.map((term, idx) => (
                <li key={idx} className="text-sm text-ink">
                  {term}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Microcopy */}
      <p className="text-xs text-archive mb-3">
        This draft is not applied until you approve it.
      </p>

      {/* Actions */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-2">
          <button
            onClick={onApply}
            className="px-3 py-1.5 text-sm bg-bark text-parchment rounded hover:bg-copper-dark"
          >
            Apply
          </button>
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 text-sm bg-parchment border border-lichen rounded hover:bg-stone flex items-center gap-1"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                Copy
              </>
            )}
          </button>
        </div>
        <button
          onClick={onDismiss}
          className="px-3 py-1.5 text-sm text-accessible-gray hover:text-ink flex items-center gap-1"
        >
          <X className="h-3 w-3" />
          Dismiss
        </button>
      </div>

      {/* Provenance (collapsible) */}
      <div className="border-t border-lichen pt-3">
        <button
          onClick={() => setShowProvenance(!showProvenance)}
          className="flex items-center gap-2 text-xs text-accessible-gray hover:text-ink"
        >
          {showProvenance ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          Provenance
        </button>
        {showProvenance && (
          <div className="mt-2 text-xs text-accessible-gray space-y-1">
            <p>Generated {formatRelativeTime(suggestion.createdAt.toISOString())}</p>
            {suggestion.templateName && (
              <p>Template: {suggestion.templateName}</p>
            )}
            {suggestion.templateVersion && (
              <p>Version: {suggestion.templateVersion}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
