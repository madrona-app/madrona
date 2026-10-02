/**
 * LOD Readiness Types
 *
 * Shared type definitions for LOD readiness components and hooks.
 * Single source of truth to avoid duplication.
 */

/**
 * A single LOD readiness hint.
 * Hints are suggestions, not requirements.
 */
export interface LODHint {
  /** Unique hint identifier (for UI tracking/dismissal) */
  id: string;
  /** Category for grouping */
  category:
    | 'authority'
    | 'identifier'
    | 'description'
    | 'relationship'
    | 'media'
    | 'rights'
    | 'provenance';
  /** Impact level (not severity - indicates improvement potential) */
  impact: 'high' | 'medium' | 'low';
  /** User-friendly message */
  message: string;
  /** Actionable suggestion */
  suggestion: string;
  /** Field(s) this hint relates to */
  fields: string[];
  /** Current value (for context) */
  currentValue?: string;
  /** Example of good value */
  example?: string;
  /** Link to documentation/help */
  helpUrl?: string;
  /** Whether this hint can be auto-fixed */
  autoFixable: boolean;
}

/**
 * Result of LOD readiness assessment.
 * The score is informational only - it does not gate any functionality.
 */
export interface LODReadinessResult {
  /** Score from 0.0 to 1.0 (percentage ready) */
  score: number;
  /** Human-readable readiness level */
  level: 'excellent' | 'good' | 'fair' | 'basic' | 'minimal';
  /** User-friendly level description */
  levelMessage: string;
  /** List of hints for improvement */
  hints: LODHint[];
  /** Counts by category */
  hintsByCategory: Record<string, number>;
  /** Counts by impact */
  hintsByImpact: Record<string, number>;
  /** What's already good */
  strengths: string[];
  /** Total number of hints */
  totalHints: number;
}

/**
 * Options for useLODReadiness hook.
 */
export interface UseLODReadinessOptions {
  /** Whether to fetch immediately on mount */
  fetchOnMount?: boolean;
  /** Refresh interval in ms (0 = no auto-refresh) */
  refreshInterval?: number;
}

/**
 * Return type for useLODReadiness hook.
 */
export interface UseLODReadinessReturn {
  result: LODReadinessResult | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  dismissHint: (hintId: string) => Promise<void>;
  dismissedHints: string[];
}
