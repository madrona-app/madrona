/**
 * LOD Readiness Components
 *
 * Non-blocking quality hints for assessing Linked Data readiness.
 * All messaging is positive and suggestive - never critical.
 */

// Types - single source of truth
export type {
  LODHint,
  LODReadinessResult,
  UseLODReadinessOptions,
  UseLODReadinessReturn,
} from './types';

// Components
export {
  LODReadinessIndicator,
  LODScoreBadge,
  InlineFieldHint,
  LODReadinessSummary,
} from './LODReadinessIndicator';

// Hooks
export {
  useLODReadiness,
  useLODScore,
  usePreviewLODReadiness,
  useCollectionLODReadiness,
} from './useLODReadiness';
