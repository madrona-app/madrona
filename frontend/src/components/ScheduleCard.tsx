import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useOrganization } from '../contexts/useOrganization';
import {
  getPipelineSchedule,
  enablePipelineSchedule,
  disablePipelineSchedule,
  deletePipelineSchedule,
} from '../lib/api';
import ScheduleModal from './ScheduleModal';
import ConfirmDialog from './ConfirmDialog';
import { useToast } from '../contexts/ToastContext';

interface ScheduleCardProps {
  pipelineId: string;
  canEdit: boolean;
}

export default function ScheduleCard({ pipelineId, canEdit }: ScheduleCardProps) {
  const { activeOrganizationId } = useOrganization();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [confirmAction, setConfirmAction] = useState<'enable' | 'disable' | 'delete' | null>(null);

  // Fetch schedule
  const { data: scheduleResponse, isLoading } = useQuery({
    queryKey: ['schedule', pipelineId],
    queryFn: () => getPipelineSchedule(pipelineId),
    enabled: !!pipelineId,
  });

  const schedule = scheduleResponse?.schedule;

  // Enable/disable mutations
  const enableMutation = useMutation({
    mutationFn: () => enablePipelineSchedule(pipelineId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule', pipelineId] });
    },
    onError: (error: any) => {
      showToast({ type: 'error', title: 'Error', message: `Failed to enable schedule: ${error.message}` });
    },
  });

  const disableMutation = useMutation({
    mutationFn: () => disablePipelineSchedule(pipelineId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule', pipelineId] });
    },
    onError: (error: any) => {
      showToast({ type: 'error', title: 'Error', message: `Failed to disable schedule: ${error.message}` });
    },
  });

  // Delete schedule mutation
  const deleteMutation = useMutation({
    mutationFn: () => deletePipelineSchedule(pipelineId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule', pipelineId] });
    },
    onError: (error: any) => {
      showToast({ type: 'error', title: 'Error', message: `Failed to delete schedule: ${error.message}` });
    },
  });

  const handleOpenCreate = () => {
    setModalMode('create');
    setShowModal(true);
  };

  const handleOpenEdit = () => {
    setModalMode('edit');
    setShowModal(true);
  };

  const handleEnable = () => {
    setConfirmAction('enable');
  };

  const handleDisable = () => {
    setConfirmAction('disable');
  };

  const handleDelete = () => {
    setConfirmAction('delete');
  };

  const handleConfirmAction = () => {
    if (confirmAction === 'enable') {
      enableMutation.mutate();
    } else if (confirmAction === 'disable') {
      disableMutation.mutate();
    } else if (confirmAction === 'delete') {
      deleteMutation.mutate();
    }
    setConfirmAction(null);
  };

  // Format frequency for display
  const formatFrequency = (schedule: any) => {
    if (schedule.type === 'time') {
      const hour = String(schedule.time_hour || 0).padStart(2, '0');
      const minute = String(schedule.time_minute || 0).padStart(2, '0');
      return `Daily at ${hour}:${minute}`;
    } else {
      const every_n = schedule.every_n || 1;
      const unit = schedule.unit || 'minutes';
      const unitLabel = every_n === 1 ? unit.slice(0, -1) : unit;
      return `Every ${every_n} ${unitLabel}`;
    }
  };

  // Format last job status
  const getStatusDisplay = (status: string) => {
    const statusColors: Record<string, string> = {
      pending: 'text-accessible-gray',
      queued: 'text-semantic-info',
      running: 'text-semantic-info',
      succeeded: 'text-accessible-gray',
      failed: 'text-semantic-error',
    };
    
    const statusLabels: Record<string, string> = {
      pending: 'Pending',
      queued: 'Queued',
      running: 'Running',
      succeeded: 'Completed',
      failed: 'Failed',
    };
    
    return {
      label: statusLabels[status] || status,
      color: statusColors[status] || 'text-accessible-gray',
    };
  };

  if (isLoading) {
    return (
      <div className="bg-parchment shadow rounded-lg p-6">
        <div className="text-archive">Loading schedule...</div>
      </div>
    );
  }

  return (
    <>
      {/* No schedule state */}
      {!schedule && (
        <div className="text-center py-8 bg-parchment border border-lichen rounded-lg">
          <p className="text-archive mb-1">No schedule configured</p>
          <p className="text-sm text-archive mb-4">This pipeline will run only when manually triggered.</p>
          {canEdit && (
            <button
              onClick={handleOpenCreate}
              className="px-4 py-2 bg-bark text-parchment rounded-md hover:bg-bark/10"
            >
              Create schedule
            </button>
          )}
        </div>
      )}

      {/* Schedule display */}
      {schedule && (
        <div className="space-y-4 bg-parchment border border-lichen rounded-lg p-4">
            {/* Status and frequency */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-sm font-medium text-archive">Status</dt>
                <dd className="mt-1 text-sm">
                  <span className="text-ink">
                    {schedule.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </dd>
              </div>

              <div>
                <dt className="text-sm font-medium text-archive">Frequency</dt>
                <dd className="mt-1 text-sm text-ink">
                  {formatFrequency(schedule)}
                </dd>
              </div>

              <div>
                <dt className="text-sm font-medium text-archive">Timezone</dt>
                <dd className="mt-1 text-sm text-ink">{schedule.timezone}</dd>
              </div>

              {schedule.last_job && (
                <div>
                  <dt className="text-sm font-medium text-archive">Last Job</dt>
                  <dd className="mt-1 text-sm">
                    {schedule.last_job.run_id ? (
                      <Link
                        to={`/organizations/${activeOrganizationId}/bridge/runs/${schedule.last_job.run_id}`}
                        className="text-semantic-info hover:underline"
                      >
                        <span className={getStatusDisplay(schedule.last_job.status).color}>
                          {getStatusDisplay(schedule.last_job.status).label}
                        </span>
                      </Link>
                    ) : (
                      <span className={getStatusDisplay(schedule.last_job.status).color}>
                        {getStatusDisplay(schedule.last_job.status).label}
                      </span>
                    )}
                  </dd>
                </div>
              )}
            </div>

            {/* Actions */}
            {canEdit && (
              <div className="flex gap-2 pt-4 border-t border-lichen">
                {schedule.enabled ? (
                  <button
                    onClick={handleDisable}
                    disabled={disableMutation.isPending}
                    className="px-3 py-1 text-sm border border-lichen rounded-md hover:bg-stone disabled:opacity-50"
                  >
                    {disableMutation.isPending ? 'Disabling...' : 'Disable'}
                  </button>
                ) : (
                  <button
                    onClick={handleEnable}
                    disabled={enableMutation.isPending}
                    className="px-3 py-1 text-sm border border-lichen rounded-md hover:bg-stone disabled:opacity-50"
                  >
                    {enableMutation.isPending ? 'Enabling...' : 'Enable'}
                  </button>
                )}
                
                <button
                  onClick={handleOpenEdit}
                  className="px-3 py-1 text-sm border border-lichen rounded-md hover:bg-stone"
                >
                  Edit
                </button>
                
                <button
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                  className="px-3 py-1 text-sm text-semantic-error border border-semantic-error/30 rounded-md hover:bg-semantic-error/20 disabled:opacity-50"
                >
                  {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            )}
          </div>
        )}

      {/* Schedule Modal */}
      <ScheduleModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        pipelineId={pipelineId}
        schedule={schedule}
        mode={modalMode}
      />

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
        title={
          confirmAction === 'enable'
            ? 'Enable Schedule'
            : confirmAction === 'disable'
            ? 'Disable Schedule'
            : 'Delete Schedule'
        }
        message={
          confirmAction === 'enable'
            ? 'Enable this schedule? The pipeline will run automatically according to the configured schedule.'
            : confirmAction === 'disable'
            ? 'Disable this schedule? The pipeline will not run automatically until re-enabled.'
            : 'Delete this schedule? This action cannot be undone.'
        }
        confirmText={
          confirmAction === 'enable'
            ? 'Enable'
            : confirmAction === 'disable'
            ? 'Disable'
            : 'Delete'
        }
        confirmStyle={confirmAction === 'delete' ? 'danger' : 'primary'}
      />
    </>
  );
}
