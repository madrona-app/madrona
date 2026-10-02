/**
 * WorkContext - Manages active object context for the WORK section
 *
 * This context implements the behavioral specification for object-centric workflows:
 * - Tracks the currently active object (if any)
 * - Persists context across navigation
 * - Provides methods to set, clear, and query object context
 * - Manages recent items for navigational memory
 */

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

// Types for object context
export interface ActiveObject {
  object_id: string;
  accession_number: string;
  title: string;
  thumbnail_url?: string | null;
}

// All record types that can appear in recent items
export type RecordType =
  | 'object'
  | 'condition_report'
  | 'loan_in'
  | 'loan_out'
  | 'acquisition'
  | 'movement'
  | 'conservation'
  | 'incident'
  | 'use_request'
  | 'exhibition'
  | 'valuation'
  | 'object_entry'
  | 'object_exit'
  | 'deaccession'
  | 'reproduction_request'
  | 'rights'
  | 'biography'
  | 'constituent'
  | 'event'
  | 'citation'
  | 'documentation_plan'
  | 'collections_review'
  | 'audit_campaign'
  | 'emergency_plan'
  | 'insurance-policy'
  | 'indemnity-arrangement'
  | 'place-authority'
  | 'style-period-authority'
  | 'subject-authority'
  | 'media_asset'
  | 'media_collection'
  | 'download_request';

export interface RecentItem {
  id: string;
  type: RecordType;
  label: string;
  sublabel?: string;
  path: string;
  timestamp: number;
  // For workflow records, track the owning group
  owningGroup?: string;
  // For workflow records, track linked object(s)
  linkedObjectId?: string;
  linkedObjectAccession?: string;
}

// Quick action definition
export interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: string;
  /** Whether this action requires object context */
  requiresObjectContext: boolean;
  /** The owning navigation group */
  owningGroup: string;
  /** Path pattern for navigation (use {objectId} placeholder if object-bound) */
  pathPattern: string;
  /** Permission required to see this action */
  permission?: string;
}

// All available quick actions per specification
export const QUICK_ACTIONS: QuickAction[] = [
  // Actions that DO NOT require object context
  {
    id: 'object-entry',
    label: 'Log Object Entry',
    description: 'Record arrival of objects for consideration',
    icon: 'PackageOpen',
    requiresObjectContext: false,
    owningGroup: 'Transactions',
    pathPattern: '/organizations/{orgId}/collections/entries/create',
    permission: 'entries.create',
  },
  {
    id: 'incident-global',
    label: 'Report Incident',
    description: 'Report damage, loss, or environmental event',
    icon: 'AlertCircle',
    requiresObjectContext: false,
    owningGroup: 'Care & Risk',
    pathPattern: '/organizations/{orgId}/collections/incidents/create',
    permission: 'incidents.create',
  },
  // Actions that REQUIRE object context
  {
    id: 'condition-report',
    label: 'New Condition Report',
    description: 'Document current physical state',
    icon: 'ClipboardCheck',
    requiresObjectContext: true,
    owningGroup: 'Care & Risk',
    pathPattern: '/organizations/{orgId}/collections/condition-reports/create?object_id={objectId}',
    permission: 'condition_reports.create',
  },
  {
    id: 'movement',
    label: 'Record Movement',
    description: 'Track relocation within facility',
    icon: 'ArrowRightLeft',
    requiresObjectContext: true,
    owningGroup: 'Location & Handling',
    pathPattern: '/organizations/{orgId}/collections/movements/create?object_id={objectId}',
    permission: 'movements.create',
  },
  {
    id: 'loan-request',
    label: 'Start Loan Request',
    description: 'Initiate outgoing loan',
    icon: 'Upload',
    requiresObjectContext: true,
    owningGroup: 'Transactions',
    pathPattern: '/organizations/{orgId}/collections/loans-out/create?object_id={objectId}',
    permission: 'loans.create',
  },
  {
    id: 'use-request',
    label: 'New Use Request',
    description: 'Record image/content usage inquiry',
    icon: 'FileQuestion',
    requiresObjectContext: true,
    owningGroup: 'Rights & Reproduction',
    pathPattern: '/organizations/{orgId}/collections/use-requests/create?object_id={objectId}',
    permission: 'use_requests.create',
  },
  {
    id: 'conservation',
    label: 'Create Conservation Record',
    description: 'Document treatment or assessment',
    icon: 'Hammer',
    requiresObjectContext: true,
    owningGroup: 'Care & Risk',
    pathPattern: '/organizations/{orgId}/collections/conservation/create?object_id={objectId}',
    permission: 'conservation.create',
  },
];

// Map record types to their owning groups (for task display)
export const RECORD_TYPE_TO_GROUP: Record<string, string> = {
  object: 'Collection',
  condition_report: 'Care & Risk',
  conservation: 'Care & Risk',
  incident: 'Care & Risk',
  valuation: 'Care & Risk',
  movement: 'Location & Handling',
  acquisition: 'Transactions',
  loan_in: 'Transactions',
  loan_out: 'Transactions',
  object_entry: 'Transactions',
  object_exit: 'Transactions',
  deaccession: 'Transactions',
  exhibition: 'Transactions',
  use_request: 'Rights & Reproduction',
  reproduction_request: 'Rights & Reproduction',
  rights: 'Rights & Reproduction',
  biography: 'People and Organizations',
  constituent: 'People and Organizations',
  event: 'Programs',
  citation: 'Research',
  documentation_plan: 'Research',
  collections_review: 'Governance',
  audit_campaign: 'Governance',
  emergency_plan: 'Care & Risk',
  media_asset: 'Media',
  media_collection: 'Media',
  download_request: 'Media',
};

interface WorkContextValue {
  // Active object context
  activeObject: ActiveObject | null;
  setActiveObject: (object: ActiveObject | null) => void;
  clearActiveObject: () => void;
  hasObjectContext: boolean;

  // Recent items
  recentItems: RecentItem[];
  addRecentItem: (item: Omit<RecentItem, 'timestamp'>) => void;
  removeRecentItem: (id: string, type: RecordType) => void;
  clearRecentItems: () => void;

  // Quick actions
  quickActions: QuickAction[];
  getAvailableQuickActions: (hasContext: boolean) => QuickAction[];
  buildActionPath: (action: QuickAction, orgId: string) => string;
}

const WorkContext = createContext<WorkContextValue | null>(null);

const STORAGE_KEY_ACTIVE_OBJECT = 'madrona.work.activeObject';
const STORAGE_KEY_RECENT_ITEMS = 'madrona.work.recentItems';
const MAX_RECENT_ITEMS = 20;

export function WorkProvider({ children }: { children: ReactNode }) {
  // Initialize from localStorage
  const [activeObject, setActiveObjectState] = useState<ActiveObject | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_ACTIVE_OBJECT);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [recentItems, setRecentItems] = useState<RecentItem[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_RECENT_ITEMS);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Persist active object to localStorage
  useEffect(() => {
    if (activeObject) {
      localStorage.setItem(STORAGE_KEY_ACTIVE_OBJECT, JSON.stringify(activeObject));
    } else {
      localStorage.removeItem(STORAGE_KEY_ACTIVE_OBJECT);
    }
  }, [activeObject]);

  // Persist recent items to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_RECENT_ITEMS, JSON.stringify(recentItems));
  }, [recentItems]);

  const setActiveObject = useCallback((object: ActiveObject | null) => {
    setActiveObjectState(object);
  }, []);

  const clearActiveObject = useCallback(() => {
    setActiveObjectState(null);
  }, []);

  const addRecentItem = useCallback((item: Omit<RecentItem, 'timestamp'>) => {
    setRecentItems(prev => {
      // Skip if already the most recent item (prevents unnecessary re-renders)
      if (prev.length > 0 && prev[0].type === item.type && prev[0].id === item.id) {
        return prev; // Same reference → no re-render
      }
      // Remove duplicate if exists
      const filtered = prev.filter(existing =>
        !(existing.type === item.type && existing.id === item.id)
      );
      const newItem: RecentItem = {
        ...item,
        timestamp: Date.now(),
      };
      return [newItem, ...filtered].slice(0, MAX_RECENT_ITEMS);
    });
  }, []);

  const removeRecentItem = useCallback((id: string, type: RecordType) => {
    setRecentItems(prev => {
      const filtered = prev.filter(item => !(item.id === id && item.type === type));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, []);

  const clearRecentItems = useCallback(() => {
    setRecentItems([]);
  }, []);

  const getAvailableQuickActions = useCallback((hasContext: boolean) => {
    if (hasContext) {
      // All actions available when object context is set
      return QUICK_ACTIONS;
    }
    // Only context-free actions when no object is selected
    return QUICK_ACTIONS.filter(action => !action.requiresObjectContext);
  }, []);

  const buildActionPath = useCallback((action: QuickAction, orgId: string) => {
    let path = action.pathPattern.replace('{orgId}', orgId);
    if (activeObject && action.requiresObjectContext) {
      path = path.replace('{objectId}', activeObject.object_id);
    }
    return path;
  }, [activeObject]);

  const value: WorkContextValue = {
    activeObject,
    setActiveObject,
    clearActiveObject,
    hasObjectContext: activeObject !== null,
    recentItems,
    addRecentItem,
    removeRecentItem,
    clearRecentItems,
    quickActions: QUICK_ACTIONS,
    getAvailableQuickActions,
    buildActionPath,
  };

  return (
    <WorkContext.Provider value={value}>
      {children}
    </WorkContext.Provider>
  );
}

export function useWork() {
  const context = useContext(WorkContext);
  if (!context) {
    throw new Error('useWork must be used within a WorkProvider');
  }
  return context;
}

/**
 * Format a task label with group ownership
 * Per specification: Tasks must show both urgency and owning group
 */
/**
 * Filter recent items to only those belonging to a specific app section.
 * Extracts the app segment from item.path (/organizations/:orgId/<appSegment>/...)
 * and compares against the active product ID.
 */
export function filterRecentItemsByApp(
  items: RecentItem[],
  activeProductId: string | null
): RecentItem[] {
  if (!activeProductId) return items;
  return items.filter((item) => {
    // Items without a valid path can't be product-scoped; exclude from filtered views
    if (!item.path) return false;
    const match = item.path.match(/\/organizations\/[^/]+\/([^/]+)/);
    return match?.[1] === activeProductId;
  });
}

export function formatTaskLabel(
  taskType: string,
  recordType: string,
  objectAccession?: string,
  objectTitle?: string,
  recordNumber?: string,
  objectCount?: number
): { label: string; groupLabel: string } {
  const group = RECORD_TYPE_TO_GROUP[recordType] || 'Unknown';

  let label = taskType;

  if (objectCount && objectCount > 1) {
    // Multiple objects
    label = `${taskType}: ${recordNumber || 'Record'} (${objectCount} objects${objectAccession ? ` incl. ${objectAccession}` : ''})`;
  } else if (objectAccession) {
    // Single object
    const truncatedTitle = objectTitle && objectTitle.length > 30
      ? objectTitle.slice(0, 30) + '...'
      : objectTitle;
    label = `${taskType}: ${objectAccession}${truncatedTitle ? ` — ${truncatedTitle}` : ''}`;
  } else if (recordNumber) {
    label = `${taskType}: ${recordNumber}`;
  }

  return { label, groupLabel: group };
}
