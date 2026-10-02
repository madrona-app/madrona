import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Truck, FileSearch, Scale, CheckCircle, Loader2 } from 'lucide-react';
import { getCollectionsImpact } from '../../lib/api';

interface EventCollectionsImpactProps {
  organizationId: string;
  eventId: string;
}

/**
 * Displays collections impact analysis for a scheduled event with objects.
 * Shows suggestions for movement planning, condition checks, and rights verification.
 */
export function EventCollectionsImpact({ organizationId, eventId }: EventCollectionsImpactProps) {
  const { data: impact, isLoading, error } = useQuery({
    queryKey: ['collections-impact', organizationId, eventId],
    queryFn: () => getCollectionsImpact(organizationId, eventId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-archive py-4">
        <Loader2 size={16} className="animate-spin" />
        Analyzing collections impact...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-semantic-error py-4">
        Failed to load collections impact: {(error as Error).message}
      </div>
    );
  }

  if (!impact || impact.total_objects === 0) {
    return (
      <div className="text-sm text-archive italic py-4 text-center">
        No objects linked to this event.
      </div>
    );
  }

  const hasAnyImpact =
    impact.needs_movement_plan || impact.needs_condition_checks || impact.needs_rights_verification;

  if (!hasAnyImpact) {
    return (
      <div className="flex items-center gap-2 text-sm text-semantic-success py-4">
        <CheckCircle size={16} />
        No collections procedures required for this event.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-archive">
        Based on the planned use of {impact.total_objects} object
        {impact.total_objects !== 1 ? 's' : ''}, the following collections procedures may be needed:
      </p>

      {/* Movement Plan */}
      {impact.needs_movement_plan && (
        <ImpactCard
          icon={Truck}
          title="Movement Plan Required"
          description="Objects with display or handling use may need to be relocated."
          color="warning"
          objects={impact.objects_needing_movement}
          organizationId={organizationId}
        />
      )}

      {/* Condition Checks */}
      {impact.needs_condition_checks && (
        <ImpactCard
          icon={FileSearch}
          title="Condition Checks Required"
          description="Objects being handled should have condition reports before and after the event."
          color="warning"
          objects={impact.objects_needing_condition_check}
          organizationId={organizationId}
        />
      )}

      {/* Rights Verification */}
      {impact.needs_rights_verification && (
        <ImpactCard
          icon={Scale}
          title="Rights Verification Required"
          description="Objects being photographed or recorded should have cleared reproduction rights."
          color="info"
          objects={impact.objects_needing_rights_check}
          organizationId={organizationId}
        />
      )}
    </div>
  );
}

interface ImpactCardProps {
  icon: typeof AlertTriangle;
  title: string;
  description: string;
  color: 'warning' | 'info' | 'error';
  objects: Array<{
    object_id: string;
    object_number?: string | null;
    title?: string | null;
    planned_use: string;
    role: string;
  }>;
  organizationId: string;
}

const COLOR_STYLES = {
  warning: {
    bg: 'bg-semantic-warning/10',
    border: 'border-semantic-warning/30',
    icon: 'text-semantic-warning',
  },
  info: {
    bg: 'bg-semantic-info/10',
    border: 'border-semantic-info/30',
    icon: 'text-semantic-info',
  },
  error: {
    bg: 'bg-semantic-error/10',
    border: 'border-semantic-error/30',
    icon: 'text-semantic-error',
  },
};

function ImpactCard({ icon: Icon, title, description, color, objects, organizationId }: ImpactCardProps) {
  const styles = COLOR_STYLES[color];

  return (
    <div className={`${styles.bg} border ${styles.border} rounded-lg p-4`}>
      <div className="flex items-start gap-3">
        <Icon size={20} className={`${styles.icon} mt-0.5 shrink-0`} />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-ink">{title}</h4>
          <p className="text-xs text-archive mt-1">{description}</p>

          {/* Objects list */}
          <div className="mt-3 space-y-1.5">
            {objects.slice(0, 5).map((obj) => (
              <div key={obj.object_id} className="flex items-center justify-between text-xs">
                <a
                  href={`/organizations/${organizationId}/collections/objects/${obj.object_id}`}
                  className="text-bark hover:text-copper-dark no-underline truncate"
                >
                  {obj.object_number || 'Unknown'}
                  {obj.title && ` - ${obj.title}`}
                </a>
                <span className="text-archive ml-2 shrink-0">({obj.planned_use})</span>
              </div>
            ))}
            {objects.length > 5 && (
              <p className="text-xs text-archive">and {objects.length - 5} more...</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default EventCollectionsImpact;
