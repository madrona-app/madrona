import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  AlertCircle,
  Clock,
  Check,
  Eye,
  X,
  ChevronRight,
  Shield,
  FileText,
} from 'lucide-react';
import {
  listExpirationAlerts,
  getExpirationAlertsSummary,
  dismissExpirationAlert,
  acknowledgeExpirationAlert,
} from '../../lib/api';
import { formatDateShort } from '@/lib/formatters';

interface ExpirationAlertsPanelProps {
  organizationId: string;
  compact?: boolean;
}

const SEVERITY_STYLES = {
  critical: {
    bg: 'bg-semantic-error/10',
    border: 'border-semantic-error/30',
    text: 'text-semantic-error',
    icon: AlertTriangle,
    badge: 'bg-semantic-error/10 text-semantic-error',
  },
  urgent: {
    bg: 'bg-semantic-warning/10',
    border: 'border-semantic-warning/30',
    text: 'text-semantic-warning',
    icon: AlertCircle,
    badge: 'bg-semantic-warning/10 text-semantic-warning',
  },
  warning: {
    bg: 'bg-semantic-warning/10',
    border: 'border-semantic-warning/30',
    text: 'text-semantic-warning',
    icon: Clock,
    badge: 'bg-semantic-warning/10 text-semantic-warning',
  },
};

export function ExpirationAlertsPanel({ organizationId, compact = false }: ExpirationAlertsPanelProps) {
  const queryClient = useQueryClient();

  const { data: summary } = useQuery({
    queryKey: ['expiration-alerts-summary', organizationId],
    queryFn: () => getExpirationAlertsSummary(organizationId),
  });

  const { data: alertsData, isLoading } = useQuery({
    queryKey: ['expiration-alerts', organizationId, 'active'],
    queryFn: () => listExpirationAlerts(organizationId, { status: 'active', limit: compact ? 5 : 50 }),
  });

  const dismissMutation = useMutation({
    mutationFn: (alertId: string) => dismissExpirationAlert(organizationId, alertId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expiration-alerts', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['expiration-alerts-summary', organizationId] });
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (alertId: string) => acknowledgeExpirationAlert(organizationId, alertId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expiration-alerts', organizationId] });
    },
  });

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-6 bg-stone/50 rounded w-48" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-stone/50 rounded" />
        ))}
      </div>
    );
  }

  const alerts = alertsData?.items || [];
  const total = summary?.total_active || 0;

  if (total === 0) {
    return (
      <div className="p-4 bg-semantic-success/10 border border-semantic-success/30 rounded flex items-center gap-3">
        <Check size={20} className="text-semantic-success" />
        <div>
          <p className="font-medium text-semantic-success">No expiration alerts</p>
          <p className="text-sm text-semantic-success">All rights and consents are up to date.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Badges */}
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="font-medium flex items-center gap-2">
          <AlertTriangle size={18} className="text-semantic-warning" />
          Expiration Alerts
        </h3>
        {summary && (
          <div className="flex gap-2">
            {summary.by_severity.critical > 0 && (
              <span className={`px-2 py-0.5 text-xs font-medium rounded ${SEVERITY_STYLES.critical.badge}`}>
                {summary.by_severity.critical} Critical
              </span>
            )}
            {summary.by_severity.urgent > 0 && (
              <span className={`px-2 py-0.5 text-xs font-medium rounded ${SEVERITY_STYLES.urgent.badge}`}>
                {summary.by_severity.urgent} Urgent
              </span>
            )}
            {summary.by_severity.warning > 0 && (
              <span className={`px-2 py-0.5 text-xs font-medium rounded ${SEVERITY_STYLES.warning.badge}`}>
                {summary.by_severity.warning} Warning
              </span>
            )}
          </div>
        )}
      </div>

      {/* Alert List */}
      <div className="space-y-2">
        {alerts.map((alert) => {
          const style = SEVERITY_STYLES[alert.severity];
          const Icon = style.icon;

          return (
            <div
              key={alert.alert_id}
              className={`p-3 border rounded ${style.bg} ${style.border}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Icon size={18} className={style.text} />
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        to={`/organizations/${organizationId}/media/${alert.media_id}`}
                        className="font-medium hover:underline"
                      >
                        {alert.media_title || alert.media_filename || 'Untitled Media'}
                      </Link>
                      <span className={`px-1.5 py-0.5 text-xs rounded ${style.badge}`}>
                        {alert.alert_type === 'rights' ? (
                          <span className="flex items-center gap-1">
                            <FileText size={10} />
                            Rights
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <Shield size={10} />
                            Consent
                          </span>
                        )}
                      </span>
                    </div>
                    <p className={`text-sm ${style.text}`}>
                      Expires {alert.expiry_date ? formatDateShort(alert.expiry_date) : 'soon'}
                      {' '}({alert.days_until_expiry} {alert.days_until_expiry === 1 ? 'day' : 'days'} remaining)
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => acknowledgeMutation.mutate(alert.alert_id)}
                    disabled={acknowledgeMutation.isPending}
                    className="p-1.5 hover:bg-parchment/50 rounded text-archive"
                    title="Acknowledge"
                  >
                    <Eye size={16} />
                  </button>
                  <button
                    onClick={() => dismissMutation.mutate(alert.alert_id)}
                    disabled={dismissMutation.isPending}
                    className="p-1.5 hover:bg-parchment/50 rounded text-archive"
                    title="Dismiss"
                  >
                    <X size={16} />
                  </button>
                  <Link
                    to={`/organizations/${organizationId}/media/${alert.media_id}`}
                    className="p-1.5 hover:bg-parchment/50 rounded"
                    title="View Media"
                  >
                    <ChevronRight size={16} />
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Show More Link */}
      {compact && total > 5 && (
        <Link
          to={`/organizations/${organizationId}/media?alerts=true`}
          className="block text-center text-sm text-bark hover:text-copper-dark"
        >
          View all {total} alerts
        </Link>
      )}
    </div>
  );
}
