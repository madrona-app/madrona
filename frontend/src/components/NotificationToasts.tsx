import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../hooks/useNotifications';
import type { Notification } from '../hooks/useNotifications';
import { useToast } from '../contexts/ToastContext';
import { useRunUpdates } from '../hooks/useRunUpdates';
import { useOrganization } from '../contexts/useOrganization';
import type { Toast } from '../contexts/ToastContext';

// Map backend notification types to toast severity levels.
// Unmapped types fall back to 'info'.
const NOTIFICATION_TOAST_TYPE: Record<string, Toast['type']> = {
  // Generic / direct
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'error',
  // Workflow
  status_changed: 'info',
  assigned: 'info',
  unassigned: 'warning',
  approved: 'success',
  approval_needed: 'warning',
  completed: 'success',
  // Tasks
  task_assigned: 'info',
  task_unassigned: 'warning',
  task_updated: 'info',
  task_deleted: 'warning',
  // Comments
  comment: 'info',
  // SLA
  sla_warning: 'warning',
  sla_breached: 'error',
  // Media / search
  search_results_updated: 'success',
};

/**
 * Component that bridges WebSocket notifications and run updates to toasts.
 *
 * This component doesn't render anything visible - it just listens
 * for WebSocket events and shows toast notifications when they arrive.
 */
export function NotificationToasts() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { activeOrganizationId } = useOrganization();

  // Handle run completion/failure notifications
  const handleRunUpdate = useCallback(
    (update: { runId: string; pipelineId: string; status: string; error?: string }) => {
      // Only show toasts for terminal states
      if (update.status === 'completed') {
        showToast({
          type: 'success',
          title: 'Run Completed',
          message: 'Pipeline run finished successfully.',
          action: {
            label: 'View Run',
            onClick: () => navigate(`/organizations/${activeOrganizationId}/bridge/runs/${update.runId}`),
          },
        });
      } else if (update.status === 'failed') {
        showToast({
          type: 'error',
          title: 'Run Failed',
          message: update.error || 'Pipeline run encountered an error.',
          action: {
            label: 'View Details',
            onClick: () => navigate(`/organizations/${activeOrganizationId}/bridge/runs/${update.runId}`),
          },
        });
      }
    },
    [showToast, navigate, activeOrganizationId]
  );

  // Handle general notifications from WebSocket
  const handleNotification = useCallback(
    (notification: Notification) => {
      const toastType = NOTIFICATION_TOAST_TYPE[notification.type] ?? 'info';

      showToast({
        type: toastType,
        title: notification.title,
        message: notification.message,
        // If the notification has pipeline/run data, add an action to navigate
        action: notification.data.run_id
          ? {
              label: 'View',
              onClick: () =>
                navigate(`/organizations/${activeOrganizationId}/bridge/runs/${notification.data.run_id}`),
            }
          : notification.data.pipeline_id
            ? {
                label: 'View',
                onClick: () =>
                  navigate(`/organizations/${activeOrganizationId}/bridge/setup/pipelines/${notification.data.pipeline_id}`),
              }
            : undefined,
      });
    },
    [showToast, navigate, activeOrganizationId]
  );

  // Subscribe to run updates (completed/failed events)
  useRunUpdates({
    onRunCompleted: handleRunUpdate,
    onRunFailed: handleRunUpdate,
  });

  // Subscribe to general notifications
  useNotifications({
    onNotification: handleNotification,
  });

  // This component doesn't render anything
  return null;
}
