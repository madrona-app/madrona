/**
 * Route-level configuration for automatic recent page tracking.
 *
 * Maps URL path segments to record metadata and React Query cache keys,
 * enabling the useRecentPageTracker hook to automatically resolve labels
 * from the query cache when a user visits a record page.
 */

import type { RecordType } from '../contexts/WorkContext';

export interface RouteRecordConfig {
  /** Record type for the RecentItem */
  type: RecordType;
  /** React Query cache key prefix, e.g. 'object-entry' → ['object-entry', orgId, id] */
  queryKeyPrefix: string;
  /** Field on the cached record to use as the primary label */
  labelField: string;
  /** Optional field for a secondary label */
  sublabelField?: string;
  /** Human-readable name used as fallback label prefix */
  displayName: string;
}

/**
 * Map from URL path segment (the part after /collections/ or /media/)
 * to its record config.
 *
 * The key is the plural URL segment as it appears in the route, e.g.
 * /organizations/:orgId/collections/entries/:entryId → key is 'entries'
 */
export const ROUTE_RECORD_CONFIG: Record<string, RouteRecordConfig> = {
  // Collection management
  'objects': {
    type: 'object',
    queryKeyPrefix: 'collection-object',
    labelField: 'object_number',
    sublabelField: 'title',
    displayName: 'Object',
  },

  // Transactions
  'entries': {
    type: 'object_entry',
    queryKeyPrefix: 'object-entry',
    labelField: 'entry_number',
    sublabelField: 'depositor_name',
    displayName: 'Entry',
  },
  'acquisitions': {
    type: 'acquisition',
    queryKeyPrefix: 'acquisition',
    labelField: 'acquisition_number',
    sublabelField: 'source_name',
    displayName: 'Acquisition',
  },
  'exits': {
    type: 'object_exit',
    queryKeyPrefix: 'object-exit',
    labelField: 'exit_number',
    displayName: 'Exit',
  },
  'deaccessions': {
    type: 'deaccession',
    queryKeyPrefix: 'deaccession',
    labelField: 'deaccession_number',
    displayName: 'Deaccession',
  },
  'loans-in': {
    type: 'loan_in',
    queryKeyPrefix: 'loan-in',
    labelField: 'loan_number',
    sublabelField: 'lender_name',
    displayName: 'Loan In',
  },
  'loans-out': {
    type: 'loan_out',
    queryKeyPrefix: 'loan-out',
    labelField: 'loan_number',
    sublabelField: 'borrower_name',
    displayName: 'Loan Out',
  },

  // Location & handling
  'movements': {
    type: 'movement',
    queryKeyPrefix: 'movement',
    labelField: 'movement_reference_number',
    displayName: 'Movement',
  },

  // Care & risk
  'condition-reports': {
    type: 'condition_report',
    queryKeyPrefix: 'condition-report',
    labelField: 'report_number',
    displayName: 'Report',
  },
  'conservation': {
    type: 'conservation',
    queryKeyPrefix: 'conservation-treatment',
    labelField: 'treatment_number',
    displayName: 'Treatment',
  },
  'incidents': {
    type: 'incident',
    queryKeyPrefix: 'incident-report',
    labelField: 'report_number',
    displayName: 'Incident',
  },
  'valuations': {
    type: 'valuation',
    queryKeyPrefix: 'valuation',
    labelField: 'valuation_number',
    displayName: 'Valuation',
  },
  'emergency-plans': {
    type: 'emergency_plan',
    queryKeyPrefix: 'emergency-plan',
    labelField: 'plan_number',
    sublabelField: 'title',
    displayName: 'Plan',
  },

  // Rights & reproduction
  'use-requests': {
    type: 'use_request',
    queryKeyPrefix: 'use-request',
    labelField: 'request_number',
    displayName: 'Request',
  },
  'reproduction-requests': {
    type: 'reproduction_request',
    queryKeyPrefix: 'reproduction-request',
    labelField: 'request_number',
    displayName: 'Request',
  },
  'rights': {
    type: 'rights',
    queryKeyPrefix: 'right',
    labelField: 'right_type',
    displayName: 'Right',
  },

  // Constituents & authorities
  'contacts': {
    type: 'constituent',
    queryKeyPrefix: 'contact',
    labelField: 'name',
    displayName: 'Contact',
  },
  'authorities': {
    type: 'biography',
    queryKeyPrefix: 'authority',
    labelField: 'preferred_name',
    displayName: 'Authority',
  },
  'place-authorities': {
    type: 'place-authority',
    queryKeyPrefix: 'place-authority',
    labelField: 'preferred_name',
    displayName: 'Place',
  },
  'style-period-authorities': {
    type: 'style-period-authority',
    queryKeyPrefix: 'style-period-authority',
    labelField: 'preferred_term',
    displayName: 'Style/Period',
  },
  'subject-authorities': {
    type: 'subject-authority',
    queryKeyPrefix: 'subject-authority',
    labelField: 'preferred_term',
    displayName: 'Subject',
  },

  // Research
  'citations': {
    type: 'citation',
    queryKeyPrefix: 'citation',
    labelField: 'brief_citation',
    sublabelField: 'title',
    displayName: 'Citation',
  },
  'documentation-plans': {
    type: 'documentation_plan',
    queryKeyPrefix: 'documentation-plan',
    labelField: 'plan_number',
    sublabelField: 'title',
    displayName: 'Plan',
  },

  // Governance
  'reviews': {
    type: 'collections_review',
    queryKeyPrefix: 'collections-review',
    labelField: 'review_number',
    sublabelField: 'title',
    displayName: 'Review',
  },
  'audits': {
    type: 'audit_campaign',
    queryKeyPrefix: 'audit-campaign',
    labelField: 'campaign_number',
    sublabelField: 'title',
    displayName: 'Audit',
  },

  // Programs
  'events': {
    type: 'event',
    queryKeyPrefix: 'event',
    labelField: 'title',
    displayName: 'Event',
  },
  'exhibitions': {
    type: 'exhibition',
    queryKeyPrefix: 'exhibition',
    labelField: 'title',
    displayName: 'Exhibition',
  },

  // Insurance
  'insurance/policies': {
    type: 'insurance-policy',
    queryKeyPrefix: 'insurance-policy',
    labelField: 'policy_number',
    displayName: 'Policy',
  },
  'insurance/indemnities': {
    type: 'indemnity-arrangement',
    queryKeyPrefix: 'indemnity-arrangement',
    labelField: 'internal_reference',
    sublabelField: 'program_label',
    displayName: 'Indemnity',
  },
};

/**
 * Media route configs. Keyed by segment under /media/.
 * Special case: '_root' matches /media/:mediaId directly (no segment).
 */
export const MEDIA_ROUTE_RECORD_CONFIG: Record<string, RouteRecordConfig> = {
  '_root': {
    type: 'media_asset',
    queryKeyPrefix: 'media',
    labelField: 'title',
    sublabelField: 'filename',
    displayName: 'Asset',
  },
  'collections': {
    type: 'media_collection',
    queryKeyPrefix: 'media-collection',
    labelField: 'name',
    displayName: 'Collection',
  },
  'download-requests': {
    type: 'download_request',
    queryKeyPrefix: 'download-request',
    labelField: 'request_number',
    sublabelField: 'requester_name',
    displayName: 'Download Request',
  },
};

export interface ParsedRoute {
  orgId: string;
  recordId: string;
  config: RouteRecordConfig;
}

/**
 * Parse a pathname into record route components.
 * Returns null for non-record pages (list views, /create pages, etc.)
 *
 * Supports patterns like:
 *   /organizations/:orgId/collections/:segment/:recordId
 *   /organizations/:orgId/collections/insurance/policies/:recordId
 *   /organizations/:orgId/media/:mediaId  (root-level media asset)
 *   /organizations/:orgId/media/:segment/:recordId
 */
export function parseRecordRoute(pathname: string): ParsedRoute | null {
  const parts = pathname.split('/').filter(Boolean);

  if (parts.length < 4 || parts[0] !== 'organizations') return null;

  const orgId = parts[1];
  const appSegment = parts[2];

  // Handle media routes
  if (appSegment === 'media') {
    return parseMediaRoute(parts, orgId);
  }

  // Collections / exhibit routes need at least 5 parts
  if (parts.length < 5) return null;
  if (appSegment !== 'collections' && appSegment !== 'exhibit') return null;

  // Try two-level segment first (e.g. insurance/policies)
  let segment: string | undefined;
  let recordId: string | undefined;

  if (parts.length >= 6) {
    const twoLevelKey = `${parts[3]}/${parts[4]}`;
    if (ROUTE_RECORD_CONFIG[twoLevelKey]) {
      segment = twoLevelKey;
      recordId = parts[5];
    }
  }

  // Fall back to single-level segment
  if (!segment) {
    segment = parts[3];
    recordId = parts[4];
  }

  if (!recordId || !segment) return null;

  // Skip /create paths
  if (recordId === 'create') return null;

  // Strip /edit suffix from recordId if present (from URL like .../entries/abc123/edit)
  if (parts[parts.length - 1] === 'edit') {
    const editIdx = parts.indexOf('edit');
    if (editIdx > 0) {
      recordId = parts[editIdx - 1];
    }
  }

  const config = ROUTE_RECORD_CONFIG[segment];
  if (!config) return null;

  return { orgId, recordId, config };
}

/**
 * Parse media routes:
 *   /organizations/:orgId/media/:mediaId  → _root config (asset detail)
 *   /organizations/:orgId/media/:segment/:recordId  → segment config
 */
function parseMediaRoute(parts: string[], orgId: string): ParsedRoute | null {
  // Skip known non-record paths (list pages, work section, workspaces)
  const skipSegments = ['work', 'workspaces', 'upload', 'search'];

  if (parts.length === 4) {
    // /organizations/:orgId/media/:mediaId — root-level asset detail
    const recordId = parts[3];
    if (recordId === 'create' || skipSegments.includes(recordId)) return null;
    const config = MEDIA_ROUTE_RECORD_CONFIG['_root'];
    if (!config) return null;
    return { orgId, recordId, config };
  }

  if (parts.length >= 5) {
    const segment = parts[3];
    if (skipSegments.includes(segment)) return null;

    // Sub-route of a media detail page (e.g. /media/:mediaId/annotations)
    // Treat as the same root media asset record
    const mediaDetailSubRoutes = ['annotations', 'transform', 'rights', 'preservation', 'ai', 'history'];
    if (parts.length === 5 && mediaDetailSubRoutes.includes(parts[4])) {
      const config = MEDIA_ROUTE_RECORD_CONFIG['_root'];
      if (!config) return null;
      return { orgId, recordId: segment, config };
    }

    const recordId = parts[4];
    if (!recordId || recordId === 'create') return null;

    // Strip /edit suffix
    const actualRecordId = parts[parts.length - 1] === 'edit' && parts.length > 5
      ? parts[parts.length - 2]
      : recordId;

    const config = MEDIA_ROUTE_RECORD_CONFIG[segment];
    if (!config) return null;
    return { orgId, recordId: actualRecordId, config };
  }

  return null;
}
