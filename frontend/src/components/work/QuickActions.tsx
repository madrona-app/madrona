/**
 * QuickActions - Context-aware action launcher
 *
 * Per specification:
 * - In global mode: Only show actions that don't require object context,
 *   or show disabled actions with explanation
 * - In object-context mode: All actions available, pre-bound to active object
 * - Never create orphan records
 */

import { Link, useNavigate } from 'react-router-dom';
import {
  PackageOpen,
  AlertCircle,
  ClipboardCheck,
  ArrowRightLeft,
  Upload,
  FileQuestion,
  Hammer,
  Package,
  Search,
  DollarSign,
  type LucideIcon,
} from 'lucide-react';
import { useWork, type QuickAction } from '../../contexts/WorkContext';
import { useOrganization } from '../../contexts/useOrganization';
import { cn } from '../../lib/utils';
import { useState } from 'react';

// Icon mapping
const ICON_MAP: Record<string, LucideIcon> = {
  PackageOpen,
  AlertCircle,
  ClipboardCheck,
  ArrowRightLeft,
  Upload,
  FileQuestion,
  Hammer,
};

interface QuickActionsProps {
  /** Show as compact list or full cards */
  variant?: 'compact' | 'cards';
  /** Limit number of actions shown */
  limit?: number;
  /** Callback when object selection is needed */
  onObjectSelectionRequired?: () => void;
  className?: string;
}

export function QuickActions({
  variant = 'cards',
  limit,
  onObjectSelectionRequired,
  className,
}: QuickActionsProps) {
  const { activeObject, hasObjectContext, quickActions, buildActionPath } = useWork();
  const { activeOrganization } = useOrganization();
  const navigate = useNavigate();
  const [showObjectPrompt, setShowObjectPrompt] = useState<string | null>(null);

  const orgId = activeOrganization?.organization_id;

  const handleActionClick = (action: QuickAction) => {
    if (!orgId) return;

    if (action.requiresObjectContext && !hasObjectContext) {
      // Per specification: Prompt for object selection
      if (onObjectSelectionRequired) {
        onObjectSelectionRequired();
      } else {
        setShowObjectPrompt(action.id);
        // Auto-hide after 3 seconds
        setTimeout(() => setShowObjectPrompt(null), 3000);
      }
      return;
    }

    // Navigate to action path
    const path = buildActionPath(action, orgId);
    navigate(path);
  };

  const actionsToShow = limit ? quickActions.slice(0, limit) : quickActions;

  if (variant === 'compact') {
    return (
      <div className={cn('space-y-1', className)}>
        {actionsToShow.map((action) => {
          const Icon = ICON_MAP[action.icon] || Package;
          const isDisabled = action.requiresObjectContext && !hasObjectContext;

          return (
            <button
              key={action.id}
              onClick={() => handleActionClick(action)}
              disabled={!orgId}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors',
                isDisabled
                  ? 'text-archive cursor-not-allowed hover:bg-stone/20'
                  : 'text-ink hover:bg-stone/30'
              )}
            >
              <Icon size={16} className={isDisabled ? 'text-archive' : 'text-bark'} />
              <span className="flex-1 text-sm">{action.label}</span>
              {isDisabled && (
                <span className="text-xs text-archive">Select object</span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  // Cards variant
  return (
    <div className={cn('space-y-3', className)}>
      {/* Context indicator */}
      {hasObjectContext && activeObject && (
        <div className="flex items-center gap-2 px-3 py-2 bg-bark/5 border border-bark/20 rounded-lg">
          <Package size={14} className="text-bark" />
          <span className="text-sm text-bark">
            Actions will apply to <strong>{activeObject.accession_number}</strong>
          </span>
        </div>
      )}

      {/* Actions grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {actionsToShow.map((action) => {
          const Icon = ICON_MAP[action.icon] || Package;
          const isDisabled = action.requiresObjectContext && !hasObjectContext;
          const showPrompt = showObjectPrompt === action.id;

          return (
            <div key={action.id} className="relative">
              <button
                onClick={() => handleActionClick(action)}
                disabled={!orgId}
                className={cn(
                  'w-full flex items-start gap-3 p-4 rounded-lg border transition-all text-left',
                  isDisabled
                    ? 'border-lichen bg-stone cursor-not-allowed'
                    : 'border-lichen hover:border-bark/40 hover:shadow-sm bg-parchment'
                )}
              >
                <div
                  className={cn(
                    'p-2 rounded-lg',
                    isDisabled ? 'bg-stone/50' : 'bg-bark/10'
                  )}
                >
                  <Icon size={18} className={isDisabled ? 'text-archive' : 'text-bark'} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    'font-medium text-sm',
                    isDisabled ? 'text-archive' : 'text-ink'
                  )}>
                    {action.label}
                  </p>
                  <p className="text-xs text-archive mt-0.5">
                    {action.description}
                  </p>
                  <p className="text-xs text-archive/70 mt-1">
                    {action.owningGroup}
                  </p>
                </div>
                {isDisabled && (
                  <div className="flex-shrink-0">
                    <span className="px-2 py-0.5 bg-semantic-warning/10 text-semantic-warning text-xs rounded">
                      Requires object
                    </span>
                  </div>
                )}
              </button>

              {/* Object selection prompt overlay */}
              {showPrompt && (
                <div className="absolute inset-0 flex items-center justify-center bg-parchment/95 rounded-lg border border-bark/30">
                  <div className="text-center p-4">
                    <Search size={20} className="mx-auto text-bark mb-2" />
                    <p className="text-sm font-medium text-ink">Select an object first</p>
                    <p className="text-xs text-archive mt-1">
                      Navigate to an object or search to set context
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Help text for global mode */}
      {!hasObjectContext && (
        <p className="text-xs text-archive text-center mt-4">
          Some actions require an active object. Navigate to an object to enable all actions.
        </p>
      )}
    </div>
  );
}

/**
 * Inline quick action buttons for object detail pages
 * These are pre-bound to the page's object
 */
interface ObjectActionBarProps {
  objectId: string;
  accessionNumber: string;
  className?: string;
  /** Callbacks for actions - opens slideover instead of navigating */
  onConditionReportClick?: () => void;
  onMovementClick?: () => void;
  onIncidentClick?: () => void;
  onConservationClick?: () => void;
  onValuationClick?: () => void;
  onLoanRequestClick?: () => void;
  onUseRequestClick?: () => void;
}

export function ObjectActionBar({
  objectId,
  accessionNumber,
  className,
  onConditionReportClick,
  onMovementClick,
  onIncidentClick,
  onConservationClick,
  onValuationClick,
  onLoanRequestClick,
  onUseRequestClick,
}: ObjectActionBarProps) {
  const { activeOrganization } = useOrganization();
  const orgId = activeOrganization?.organization_id;

  if (!orgId) return null;

  // Actions available from object detail page (per specification)
  const actions = [
    {
      label: 'Condition Report',
      icon: ClipboardCheck,
      path: `/organizations/${orgId}/collections/condition-reports/create?object_id=${objectId}`,
      group: 'Care & Risk',
      onClick: onConditionReportClick,
    },
    {
      label: 'Movement',
      icon: ArrowRightLeft,
      path: `/organizations/${orgId}/collections/movements/create?object_id=${objectId}`,
      group: 'Location',
      onClick: onMovementClick,
    },
    {
      label: 'Incident',
      icon: AlertCircle,
      path: `/organizations/${orgId}/collections/incidents/create?object_id=${objectId}`,
      group: 'Care & Risk',
      onClick: onIncidentClick,
    },
    {
      label: 'Conservation',
      icon: Hammer,
      path: `/organizations/${orgId}/collections/conservation/create?object_id=${objectId}`,
      group: 'Care & Risk',
      onClick: onConservationClick,
    },
    {
      label: 'Valuation',
      icon: DollarSign,
      path: `/organizations/${orgId}/collections/valuations/create?object_id=${objectId}`,
      group: 'Care & Risk',
      onClick: onValuationClick,
    },
    {
      label: 'Loan Request',
      icon: Upload,
      path: `/organizations/${orgId}/collections/loans-out/create?object_id=${objectId}`,
      group: 'Transactions',
      onClick: onLoanRequestClick,
    },
    {
      label: 'Use Request',
      icon: FileQuestion,
      path: `/organizations/${orgId}/collections/use-requests/create?object_id=${objectId}`,
      group: 'Rights',
      onClick: onUseRequestClick,
    },
  ];

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {actions.map((action) =>
        action.onClick ? (
          <button
            key={action.label}
            onClick={action.onClick}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-bark bg-bark/5 hover:bg-bark/10 border border-bark/20 rounded-lg transition-colors"
            title={`Create ${action.label} for ${accessionNumber}`}
          >
            <action.icon size={14} />
            {action.label}
          </button>
        ) : (
          <Link
            key={action.label}
            to={action.path}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-bark bg-bark/5 hover:bg-bark/10 border border-bark/20 rounded-lg transition-colors"
            title={`Create ${action.label} for ${accessionNumber}`}
          >
            <action.icon size={14} />
            {action.label}
          </Link>
        )
      )}
    </div>
  );
}
