/**
 * LOD Readiness Indicator Component
 *
 * Displays Linked Data readiness score and hints.
 * All messaging is positive and suggestive - never critical.
 *
 * Design principles:
 * - Hints are helpful suggestions, not requirements
 * - Never block or prevent actions
 * - Progressive disclosure - summary first, details on demand
 * - Dismissible hints with user preferences
 */

import { useState } from 'react';
import type { LODHint, LODReadinessResult } from './types';

// Re-export types for backward compatibility
export type { LODHint, LODReadinessResult } from './types';

// ============================================================================
// TYPES
// ============================================================================

interface LODReadinessIndicatorProps {
  result: LODReadinessResult;
  onDismissHint?: (hintId: string) => void;
  onAutoFix?: (hintId: string) => void;
  dismissedHints?: string[];
  compact?: boolean;
  showStrengths?: boolean;
}

// ============================================================================
// UI COPY - Positive, encouraging language
// ============================================================================

const LEVEL_COLORS: Record<string, string> = {
  excellent: 'text-semantic-success bg-semantic-success/10',
  good: 'text-semantic-info bg-semantic-info/10',
  fair: 'text-semantic-warning bg-semantic-warning/10',
  basic: 'text-copper bg-copper/10',
  minimal: 'text-archive bg-stone',
};

const LEVEL_LABELS: Record<string, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  basic: 'Basic',
  minimal: 'Getting Started',
};

const CATEGORY_LABELS: Record<string, string> = {
  authority: 'Authority Links',
  identifier: 'Identification',
  description: 'Description',
  relationship: 'Relationships',
  media: 'Images',
  rights: 'Rights',
  provenance: 'Provenance',
};

const CATEGORY_ICONS: Record<string, string> = {
  authority: '🔗',
  identifier: '🏷️',
  description: '📝',
  relationship: '↔️',
  media: '🖼️',
  rights: '©️',
  provenance: '📜',
};

const IMPACT_STYLES: Record<string, string> = {
  high: 'border-l-4 border-bark',
  medium: 'border-l-4 border-lichen',
  low: 'border-l-2 border-lichen',
};

// ============================================================================
// COMPACT SCORE BADGE
// ============================================================================

export function LODScoreBadge({
  score,
  level,
  size = 'md',
}: {
  score: number;
  level: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-sm px-2 py-1',
    lg: 'text-base px-3 py-1.5',
  };

  const percentage = Math.round(score * 100);

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${LEVEL_COLORS[level]} ${sizeClasses[size]}`}
      title={`LOD Readiness: ${percentage}%`}
    >
      <span className="mr-1">{percentage}%</span>
      <span className="opacity-75">{LEVEL_LABELS[level]}</span>
    </span>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function LODReadinessIndicator({
  result,
  onDismissHint,
  onAutoFix,
  dismissedHints = [],
  compact = false,
  showStrengths = true,
}: LODReadinessIndicatorProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [_showAllHints, _setShowAllHints] = useState(false);

  // Filter out dismissed hints
  const activeHints = result.hints.filter((h) => !dismissedHints.includes(h.id));

  // Group hints by category
  const hintsByCategory = activeHints.reduce(
    (acc, hint) => {
      if (!acc[hint.category]) {
        acc[hint.category] = [];
      }
      acc[hint.category].push(hint);
      return acc;
    },
    {} as Record<string, LODHint[]>
  );

  const toggleCategory = (category: string) => {
    const next = new Set(expandedCategories);
    if (next.has(category)) {
      next.delete(category);
    } else {
      next.add(category);
    }
    setExpandedCategories(next);
  };

  // Compact view for list items
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <LODScoreBadge score={result.score} level={result.level} size="sm" />
        {activeHints.length > 0 && (
          <span className="text-xs text-archive">
            {activeHints.length} suggestion{activeHints.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="bg-parchment rounded-lg border border-lichen overflow-hidden">
      {/* Header with score */}
      <div className="px-4 py-3 bg-stone border-b border-lichen">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LODScoreBadge score={result.score} level={result.level} size="md" />
            <span className="text-sm text-archive">Linked Data Readiness</span>
          </div>
          {activeHints.length > 0 && (
            <span className="text-sm text-archive">
              {activeHints.length} suggestion{activeHints.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-archive">{result.levelMessage}</p>
      </div>

      {/* Strengths (what's already good) */}
      {showStrengths && result.strengths.length > 0 && (
        <div className="px-4 py-3 border-b border-lichen bg-semantic-success/10">
          <p className="text-xs font-medium text-semantic-success mb-1">What's working well:</p>
          <div className="flex flex-wrap gap-1">
            {result.strengths.map((strength, idx) => (
              <span
                key={idx}
                className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-semantic-success/10 text-semantic-success"
              >
                ✓ {strength}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Hints by category */}
      {activeHints.length > 0 && (
        <div className="divide-y divide-lichen">
          {Object.entries(hintsByCategory).map(([category, hints]) => (
            <div key={category}>
              {/* Category header */}
              <button
                onClick={() => toggleCategory(category)}
                className="w-full px-4 py-2 flex items-center justify-between hover:bg-stone transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span>{CATEGORY_ICONS[category] || '📋'}</span>
                  <span className="text-sm font-medium text-ink">
                    {CATEGORY_LABELS[category] || category}
                  </span>
                  <span className="text-xs text-archive bg-stone px-1.5 py-0.5 rounded-full">
                    {hints.length}
                  </span>
                </div>
                <span className="text-archive text-xs">
                  {expandedCategories.has(category) ? '▼' : '▶'}
                </span>
              </button>

              {/* Expanded hints */}
              {expandedCategories.has(category) && (
                <div className="px-4 pb-3 space-y-2">
                  {hints.map((hint) => (
                    <HintCard
                      key={hint.id}
                      hint={hint}
                      onDismiss={onDismissHint}
                      onAutoFix={onAutoFix}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {activeHints.length === 0 && (
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-archive">
            Great job! This record is well-prepared for Linked Data sharing.
          </p>
        </div>
      )}

      {/* Footer note */}
      <div className="px-4 py-2 bg-stone border-t border-lichen">
        <p className="text-xs text-archive text-center">
          These are suggestions to enhance discoverability. All fields remain optional.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// HINT CARD
// ============================================================================

function HintCard({
  hint,
  onDismiss,
  onAutoFix,
}: {
  hint: LODHint;
  onDismiss?: (id: string) => void;
  onAutoFix?: (id: string) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className={`bg-parchment rounded border border-lichen p-3 ${IMPACT_STYLES[hint.impact]}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <p className="text-sm text-ink">{hint.message}</p>
          <p className="text-xs text-archive mt-1">{hint.suggestion}</p>
        </div>
        <div className="flex items-center gap-1">
          {hint.autoFixable && onAutoFix && (
            <button
              onClick={() => onAutoFix(hint.id)}
              className="text-xs px-2 py-1 rounded bg-bark/10 text-bark hover:bg-bark/10 transition-colors"
              title="Auto-suggest authority link"
            >
              Suggest
            </button>
          )}
          {onDismiss && (
            <button
              onClick={() => onDismiss(hint.id)}
              className="text-xs px-2 py-1 rounded text-archive hover:text-archive hover:bg-stone transition-colors"
              title="Dismiss this suggestion"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Expandable details */}
      {(hint.currentValue || hint.example) && (
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-xs text-archive hover:text-archive mt-2"
        >
          {showDetails ? 'Hide details' : 'Show example'}
        </button>
      )}

      {showDetails && (
        <div className="mt-2 text-xs space-y-1">
          {hint.currentValue && (
            <div className="text-archive">
              <span className="font-medium">Current:</span>{' '}
              <code className="bg-stone px-1 rounded">{hint.currentValue}</code>
            </div>
          )}
          {hint.example && (
            <div className="text-archive">
              <span className="font-medium">Example:</span>{' '}
              <code className="bg-stone px-1 rounded text-xs break-all">{hint.example}</code>
            </div>
          )}
          {hint.helpUrl && (
            <a
              href={hint.helpUrl}
              className="text-bark hover:text-copper-dark"
              target="_blank"
              rel="noopener noreferrer"
            >
              Learn more →
            </a>
          )}
        </div>
      )}

      {/* Field tags */}
      <div className="flex flex-wrap gap-1 mt-2">
        {hint.fields.map((field) => (
          <span key={field} className="text-xs bg-stone text-archive px-1.5 py-0.5 rounded">
            {field}
          </span>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// INLINE FIELD HINT
// ============================================================================

export function InlineFieldHint({ hint }: { hint: LODHint }) {
  return (
    <div className="mt-1 flex items-start gap-2 text-xs text-archive">
      <span className="text-bark">💡</span>
      <div>
        <span>{hint.suggestion}</span>
        {hint.autoFixable && (
          <button className="ml-2 text-bark hover:text-copper-dark underline">
            Find matches
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// SUMMARY FOR LIST VIEWS
// ============================================================================

export function LODReadinessSummary({
  averageScore,
  objectCount,
  levelDistribution,
}: {
  averageScore: number;
  objectCount: number;
  levelDistribution: Record<string, number>;
}) {
  const percentage = Math.round(averageScore * 100);

  return (
    <div className="bg-parchment rounded-lg border border-lichen p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-ink">Collection LOD Readiness</h3>
        <span className="text-2xl font-bold text-ink">{percentage}%</span>
      </div>

      <p className="text-xs text-archive mb-3">
        Based on {objectCount} object{objectCount !== 1 ? 's' : ''}
      </p>

      {/* Level distribution bar */}
      <div className="flex rounded-full overflow-hidden h-2 bg-stone">
        {Object.entries(levelDistribution).map(([level, count]) => {
          const width = (count / objectCount) * 100;
          const colors: Record<string, string> = {
            excellent: 'bg-semantic-success',
            good: 'bg-semantic-info',
            fair: 'bg-semantic-warning',
            basic: 'bg-copper',
            minimal: 'bg-archive',
          };
          return (
            <div
              key={level}
              className={colors[level] || 'bg-lichen'}
              style={{ width: `${width}%` }}
              title={`${LEVEL_LABELS[level]}: ${count} objects`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3 text-xs">
        {Object.entries(levelDistribution).map(([level, count]) => (
          <div key={level} className="flex items-center gap-1">
            <span
              className={`w-2 h-2 rounded-full ${
                {
                  excellent: 'bg-semantic-success',
                  good: 'bg-semantic-info',
                  fair: 'bg-semantic-warning',
                  basic: 'bg-copper',
                  minimal: 'bg-archive',
                }[level]
              }`}
            />
            <span className="text-archive">
              {LEVEL_LABELS[level]}: {count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default LODReadinessIndicator;
