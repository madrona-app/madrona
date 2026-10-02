import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getJobs } from '../lib/api';
import type { Job } from '../lib/api';
import { useAccessibleModal, getModalAriaProps } from '../hooks/useAccessibleModal';
import { formatDateTime } from '../lib/formatters';

interface JobHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  pipelineId: string;
  organizationId: string;
}

export default function JobHistoryDrawer({
  isOpen,
  onClose,
  pipelineId,
  organizationId,
}: JobHistoryDrawerProps) {
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'job-history-drawer',
  });

  const { data: jobsData, isLoading } = useQuery({
    queryKey: ['jobs', pipelineId, organizationId],
    queryFn: () =>
      getJobs({
        organization_id: organizationId,
        pipeline_id: pipelineId,
        limit: 20,
      }),
    enabled: isOpen && !!pipelineId && !!organizationId,
  });

  const jobs = jobsData?.items || [];

  // Calculate duration in a readable format
  const formatDuration = (startedAt: string | null, finishedAt: string | null): string => {
    if (!startedAt || !finishedAt) return '—';
    
    const start = new Date(startedAt).getTime();
    const end = new Date(finishedAt).getTime();
    const durationMs = end - start;
    
    if (durationMs < 1000) return '<1s';
    
    const seconds = Math.floor(durationMs / 1000);
    if (seconds < 60) return `${seconds}s`;
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) {
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }
    
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  };

  // Format date for display
  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return '\u2014';
    return formatDateTime(dateStr);
  };

  // Get status display text
  const getStatusText = (status: string): string => {
    const statusMap: Record<string, string> = {
      pending: 'Pending',
      queued: 'Queued',
      running: 'Running',
      succeeded: 'Completed',
      failed: 'Failed',
      canceled: 'Canceled',
    };
    return statusMap[status] || status;
  };

  // Get status color
  const getStatusColor = (status: string): string => {
    const colorMap: Record<string, string> = {
      pending: 'rgb(var(--color-archive))',
      queued: 'rgb(var(--color-archive))',
      running: 'rgb(var(--color-archive))',
      succeeded: '#2C3639',
      failed: '#8B4543',
      canceled: 'rgb(var(--color-archive))',
    };
    return colorMap[status] || 'rgb(var(--color-archive))';
  };

  if (!isOpen) return null;

  return (
    /* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.3)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId, descriptionId)}
        style={{
          background: 'rgb(var(--color-parchment-warm))',
          borderRadius: '4px',
          width: '720px',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
      {/* eslint-enable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid #E4DCCB',
          }}
        >
          <h3
            id={titleId}
            style={{
              margin: 0,
              fontSize: '16px',
              fontWeight: 500,
              color: '#2C3639',
              fontFamily: 'Georgia, serif',
            }}
          >
            Job history
          </h3>
          <p
            id={descriptionId}
            style={{
              margin: '8px 0 0 0',
              fontSize: '13px',
              color: 'rgb(var(--color-archive))',
              fontFamily: 'Georgia, serif',
            }}
          >
            Last 20 scheduled jobs for this pipeline
          </p>
        </div>

        {/* Body */}
        <div
          style={{
            padding: '0',
            overflowY: 'auto',
            flex: 1,
          }}
        >
          {isLoading ? (
            <div
              role="status"
              aria-live="polite"
              style={{
                padding: '24px',
                textAlign: 'center',
                fontSize: '13px',
                color: 'rgb(var(--color-archive))',
                fontFamily: 'Georgia, serif',
              }}
            >
              Loading jobs...
            </div>
          ) : jobs.length === 0 ? (
            <div
              style={{
                padding: '24px',
                textAlign: 'center',
                fontSize: '13px',
                color: 'rgb(var(--color-archive))',
                fontFamily: 'Georgia, serif',
              }}
            >
              No jobs found for this pipeline
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {jobs.map((job: Job, index: number) => (
                <div
                  key={job.job_id}
                  style={{
                    padding: '16px 24px',
                    borderBottom: index < jobs.length - 1 ? '1px solid #E4DCCB' : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  {/* Row 1: Scheduled time, Status, Duration */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                      {/* Scheduled time */}
                      <div>
                        <span
                          style={{
                            fontSize: '14px',
                            color: '#2C3639',
                            fontFamily: 'Georgia, serif',
                            fontWeight: 500,
                          }}
                        >
                          {formatDate(job.scheduled_for)}
                        </span>
                      </div>

                      {/* Status */}
                      <div>
                        <span
                          style={{
                            fontSize: '13px',
                            color: getStatusColor(job.status),
                            fontFamily: 'Georgia, serif',
                          }}
                        >
                          {getStatusText(job.status)}
                        </span>
                      </div>
                    </div>

                    {/* Duration */}
                    <div>
                      <span
                        style={{
                          fontSize: '13px',
                          color: 'rgb(var(--color-archive))',
                          fontFamily: 'Georgia, serif',
                        }}
                      >
                        {formatDuration(job.started_at, job.finished_at)}
                      </span>
                    </div>
                  </div>

                  {/* Row 2: Run link or error snippet */}
                  {job.run_id && (
                    <div>
                      <Link
                        to={`/organizations/${organizationId}/bridge/runs/${job.run_id}`}
                        style={{
                          fontSize: '13px',
                          color: 'rgb(var(--color-archive))',
                          fontFamily: 'Georgia, serif',
                          textDecoration: 'none',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.textDecoration = 'underline';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.textDecoration = 'none';
                        }}
                      >
                        View run →
                      </Link>
                    </div>
                  )}

                  {job.error && (
                    <div
                      style={{
                        padding: '8px 12px',
                        background: '#FEF3F2',
                        border: '1px solid #F9CECA',
                        borderRadius: '2px',
                        fontSize: '12px',
                        color: '#8B4543',
                        fontFamily: 'Georgia, serif',
                        maxWidth: '100%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={job.error}
                    >
                      {job.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid #E4DCCB',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              border: '1px solid #D8D2C8',
              borderRadius: '2px',
              background: 'rgb(var(--color-parchment-warm))',
              fontSize: '14px',
              fontFamily: 'Georgia, serif',
              color: '#2C3639',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
