import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, CheckCircle2, Clock, AlertTriangle, MinusCircle } from 'lucide-react';
import { formatDateShort } from '@/lib/formatters';
import { WorkspaceSection, SectionEmptyState } from '../../../components/workspace';
import { apiFetch } from '../../../lib/apiClient';

interface MonitoringEvent {
  event_id: string;
  event_type: string;
  due_date: string;
  status: 'pending' | 'completed' | 'overdue' | 'skipped';
  completed_date?: string | null;
  completed_by?: string | null;
  notes?: string | null;
}

interface MonitoringSectionProps {
  organizationId: string;
  loanId: string;
  isExpanded: boolean;
  isEditing: boolean;
  order: number | undefined;
  onToggle: () => void;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  condition_check: 'Condition Check',
  environment_check: 'Environment & Display Check',
  insurance_review: 'Insurance Review',
  general_review: 'General Review',
};

const STATUS_CONFIG: Record<string, { className: string; icon: typeof Clock; label: string }> = {
  pending: {
    className: 'bg-semantic-warning/10 text-semantic-warning',
    icon: Clock,
    label: 'Pending',
  },
  completed: {
    className: 'bg-semantic-success/10 text-semantic-success',
    icon: CheckCircle2,
    label: 'Completed',
  },
  overdue: {
    className: 'bg-semantic-error/10 text-semantic-error',
    icon: AlertTriangle,
    label: 'Overdue',
  },
  skipped: {
    className: 'bg-stone text-archive',
    icon: MinusCircle,
    label: 'Skipped',
  },
};

export function MonitoringSection({
  organizationId,
  loanId,
  isExpanded,
  isEditing,
  order,
  onToggle,
}: MonitoringSectionProps) {
  const queryClient = useQueryClient();
  const [completingId, setCompletingId] = useState<string | null>(null);

  const { data: events = [], isLoading } = useQuery<MonitoringEvent[]>({
    queryKey: ['loan-out-monitoring', organizationId, loanId],
    queryFn: async () => {
      const response = await apiFetch<{ events: MonitoringEvent[] }>(
        `/organizations/${organizationId}/collections/loans-out/${loanId}/monitoring`
      );
      return response.events;
    },
    enabled: !!organizationId && !!loanId,
  });

  const markCompleteMutation = useMutation({
    mutationFn: async (eventId: string) => {
      return apiFetch(
        `/organizations/${organizationId}/collections/loans-out/${loanId}/monitoring/${eventId}`,
        { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['loan-out-monitoring', organizationId, loanId],
      });
      setCompletingId(null);
    },
    onError: () => {
      setCompletingId(null);
    },
  });

  const handleMarkComplete = (eventId: string) => {
    setCompletingId(eventId);
    markCompleteMutation.mutate(eventId);
  };

  return (
    <WorkspaceSection
      id="monitoring"
      title="Monitoring"
      icon={<Activity size={18} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={order}
    >
      {isLoading ? (
        <div className="py-8 text-center text-archive text-sm">Loading monitoring events...</div>
      ) : events.length === 0 ? (
        <SectionEmptyState
          message="Monitoring events will be generated when the loan status changes to On Loan"
          isEditing={isEditing}
        />
      ) : (
        <div className="space-y-3">
          {events.map((event) => {
            const config = STATUS_CONFIG[event.status] ?? STATUS_CONFIG.pending;
            const StatusIcon = config.icon;

            return (
              <div
                key={event.event_id}
                className="flex items-start gap-3 border border-lichen rounded-lg p-4"
              >
                <div className="mt-0.5">
                  <StatusIcon size={18} className={config.className.split(' ').find((c) => c.startsWith('text-')) ?? 'text-archive'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-ink">
                      {EVENT_TYPE_LABELS[event.event_type] ?? event.event_type}
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.className}`}>
                      {config.label}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-archive">
                    Due: {formatDateShort(event.due_date)}
                  </div>
                  {event.status === 'completed' && (
                    <div className="mt-1 text-sm text-archive">
                      {event.completed_date && (
                        <span>Completed: {formatDateShort(event.completed_date)}</span>
                      )}
                      {event.completed_by && (
                        <span className="ml-2">by {event.completed_by}</span>
                      )}
                    </div>
                  )}
                  {event.notes && (
                    <div className="mt-1 text-sm text-archive">{event.notes}</div>
                  )}
                </div>
                {event.status === 'pending' && (
                  <button
                    type="button"
                    className="btn-secondary text-xs px-3 py-1.5 rounded-md whitespace-nowrap"
                    onClick={() => handleMarkComplete(event.event_id)}
                    disabled={completingId === event.event_id}
                  >
                    {completingId === event.event_id ? 'Completing...' : 'Mark Complete'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </WorkspaceSection>
  );
}
