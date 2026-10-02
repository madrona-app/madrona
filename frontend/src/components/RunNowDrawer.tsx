import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Play, AlertCircle, CheckCircle, Loader, Settings, Clock } from 'lucide-react';
import { createRun, executeRun, getRun } from '../lib/api';
import { formatRelativeTime, formatDuration, getStatusLabel, isTerminalStatus, isActiveStatus } from '../lib/utils';
import { usePermissions } from '../hooks/usePermissions';
import { Tooltip } from './Tooltip';
import type { Run } from '../lib/schemas';
import { useAccessibleModal, getModalAriaProps } from '../hooks/useAccessibleModal';
import { logger } from '../lib/logger';

interface RunNowDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  pipelineId: string;
  latestRun: Run | null;
  onRunComplete: (run: Run) => void;
  connectorInstanceId?: string;
  connectorType: 'source' | 'destination';
  organizationId?: string;
}

export default function RunNowDrawer({
  isOpen,
  onClose,
  pipelineId,
  latestRun,
  onRunComplete,
  connectorInstanceId,
  connectorType,
  organizationId,
}: RunNowDrawerProps) {
  const { modalRef, titleId, descriptionId: _descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'run-now-drawer',
  });
  const [isRunning, setIsRunning] = useState(false);
  const [currentRun, setCurrentRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFullResyncConfirm, setShowFullResyncConfirm] = useState(false);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onRunCompleteRef = useRef(onRunComplete);
  onRunCompleteRef.current = onRunComplete;

  // Check permissions
  const { hasPermission } = usePermissions();
  const canExecute = hasPermission('runs.execute');
  const canForceFullSync = hasPermission('runs.force_full');

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // Stop polling when drawer closes
  useEffect(() => {
    if (!isOpen) {
      stopPolling();
    }
  }, [isOpen, stopPolling]);

  // Clean up polling on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const handleRunNow = async (forceFullSync = false) => {
    if (!organizationId) {
      setError('Organization ID is required');
      return;
    }

    try {
      setIsRunning(true);
      setError(null);
      setCurrentRun(null);

      // Step 1: Create the run
      const newRun = await createRun(pipelineId, organizationId, { force_full_sync: forceFullSync });
      setCurrentRun(newRun);

      // Step 2: Execute the run
      const executingRun = await executeRun(newRun.run_id, organizationId);
      setCurrentRun(executingRun);

      // Step 3: Poll for completion
      stopPolling();
      const interval = setInterval(async () => {
        try {
          const updatedRun = await getRun(executingRun.run_id, organizationId);
          setCurrentRun(updatedRun);

          if (isTerminalStatus(updatedRun.status)) {
            stopPolling();
            setIsRunning(false);
            onRunCompleteRef.current(updatedRun);
          }
        } catch (err) {
          logger.error('Polling error:', err);
          stopPolling();
          setIsRunning(false);
          setError(err instanceof Error ? err.message : 'Failed to check run status');
        }
      }, 2000); // Poll every 2 seconds

      pollingIntervalRef.current = interval;
    } catch (err) {
      logger.error('Run error:', err);
      setIsRunning(false);
      setError(err instanceof Error ? err.message : 'Failed to start run');
    }
  };

  const handleFullResyncClick = () => {
    setShowFullResyncConfirm(true);
  };

  const handleFullResyncConfirm = async () => {
    setShowFullResyncConfirm(false);
    await handleRunNow(true);
  };

  const handleFullResyncCancel = () => {
    setShowFullResyncConfirm(false);
  };

  const displayRun = currentRun || latestRun;
  const counts = displayRun?.counts;

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="drawer-backdrop"
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 999,
        }}
      />

      {/* Drawer */}
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId)}
        className="drawer"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '400px',
          maxWidth: '90vw',
          background: 'white',
          boxShadow: '-4px 0 12px rgba(0, 0, 0, 0.15)',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid #E6E4DF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h2 id={titleId} style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
            Smithsonian Open Access
          </h2>
          <button
            onClick={onClose}
            aria-label="Close drawer"
            style={{
              background: 'none',
              border: 'none',
              padding: '4px',
              cursor: 'pointer',
              color: 'rgb(var(--color-archive))',
            }}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {/* Connection Status */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '13px', color: 'rgb(var(--color-archive))', marginBottom: '4px' }}>
              Connection
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: 'rgb(var(--color-success))',
                }}
              />
              <span style={{ fontSize: '14px', fontWeight: 500 }}>Connected</span>
            </div>
          </div>

          {/* Last Run Info */}
          {displayRun && (
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '13px', color: 'rgb(var(--color-archive))', marginBottom: '8px' }}>
                Last Run
              </div>
              <div
                style={{
                  background: 'rgb(var(--color-parchment-warm))',
                  border: '1px solid #E6E4DF',
                  borderRadius: '8px',
                  padding: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px', color: 'rgb(var(--color-archive))' }}>Status</span>
                  <span style={{ fontSize: '14px', fontWeight: 500 }}>
                    {getStatusLabel(displayRun.status)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px', color: 'rgb(var(--color-archive))' }}>Time</span>
                  <span style={{ fontSize: '14px' }}>
                    {formatRelativeTime(displayRun.started_at)}
                  </span>
                </div>
                {displayRun.duration_ms && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '14px', color: 'rgb(var(--color-archive))' }}>Duration</span>
                    <span style={{ fontSize: '14px' }}>
                      {formatDuration(displayRun.duration_ms)}
                    </span>
                  </div>
                )}
                {displayRun.parameters?.sync_type && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '14px', color: 'rgb(var(--color-archive))' }}>Mode</span>
                    <span
                      style={{
                        fontSize: '13px',
                        fontWeight: 500,
                        color: displayRun.parameters.sync_type === 'incremental' ? '#1e40af' : 'rgb(var(--color-warning))',
                      }}
                    >
                      {displayRun.parameters.sync_type === 'incremental' ? 'Incremental' : 'Full'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Counts */}
          {counts && (
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '13px', color: 'rgb(var(--color-archive))', marginBottom: '8px' }}>
                Records Processed
              </div>
              <div
                style={{
                  background: 'rgb(var(--color-parchment-warm))',
                  border: '1px solid #E6E4DF',
                  borderRadius: '8px',
                  padding: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px', color: 'rgb(var(--color-archive))' }}>Total</span>
                  <span style={{ fontSize: '14px', fontWeight: 500 }}>{counts.processed}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px', color: 'rgb(var(--color-success))' }}>Created</span>
                  <span style={{ fontSize: '14px' }}>{counts.created}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '14px', color: '#3b82f6' }}>Updated</span>
                  <span style={{ fontSize: '14px' }}>{counts.updated}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '14px', color: 'rgb(var(--color-archive))' }}>Skipped</span>
                  <span style={{ fontSize: '14px' }}>{counts.noop}</span>
                </div>
              </div>
            </div>
          )}

          {/* Pipeline Already Running Warning */}
          {latestRun && isActiveStatus(latestRun.status) && !currentRun && (
            <div
              style={{
                padding: '12px',
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: '8px',
                marginBottom: '16px',
              }}
            >
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <Clock size={16} style={{ color: 'rgb(var(--color-bark))', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: '#1e40af', marginBottom: '4px' }}>
                    Pipeline Already Running
                  </div>
                  <div style={{ fontSize: '13px', color: '#1e3a8a', lineHeight: '1.4' }}>
                    A run started {formatRelativeTime(latestRun.started_at).toLowerCase()}. New runs will be queued and execute after the current run completes.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div
              style={{
                padding: '12px',
                background: 'rgb(var(--color-error))',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                marginBottom: '16px',
              }}
            >
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <AlertCircle size={16} style={{ color: 'rgb(var(--color-error))', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: 'rgb(var(--color-error))', marginBottom: '4px' }}>
                    Run Failed
                  </div>
                  <div style={{ fontSize: '13px', color: '#7f1d1d' }}>
                    {error}
                  </div>
                  {error.includes('403') && connectorInstanceId && (
                    <div style={{ marginTop: '8px', fontSize: '13px', color: '#7f1d1d' }}>
                      This may be an authentication issue. Check your connector settings.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Configure Connector */}
          {connectorInstanceId && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', color: 'rgb(var(--color-archive))', marginBottom: '8px' }}>
                Connector Settings
              </div>
              <a
                href={organizationId && connectorInstanceId ? `/organizations/${organizationId}/bridge/setup/connectors/${connectorInstanceId}` : `/settings/${connectorInstanceId}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 12px',
                  background: 'rgb(var(--color-parchment-warm))',
                  border: '1px solid #E6E4DF',
                  borderRadius: '6px',
                  fontSize: '13px',
                  color: 'rgb(var(--color-accessible-gray))',
                  textDecoration: 'none',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#f3f4f6'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'rgb(var(--color-parchment-warm))'}
              >
                <Settings size={14} />
                <span>Configure {connectorType === 'source' ? 'Source' : 'Destination'}</span>
              </a>
            </div>
          )}

          {/* Success Message */}
          {currentRun && isTerminalStatus(currentRun.status) && currentRun.status === 'success' && (
            <div
              style={{
                padding: '12px',
                background: 'rgb(var(--color-success))',
                border: '1px solid #bbf7d0',
                borderRadius: '8px',
                marginBottom: '16px',
              }}
            >
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <CheckCircle size={16} style={{ color: 'rgb(var(--color-success))', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: 'rgb(var(--color-success))', marginBottom: '4px' }}>
                    Run Complete
                  </div>
                  <div style={{ fontSize: '13px', color: '#14532d' }}>
                    Pipeline run complete.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Primary: Run Sync Now */}
            <Tooltip
              content={
                !canExecute
                  ? "You need the 'runs.execute' permission to execute runs"
                  : "Incremental runs only process records changed since the last successful sync, using a watermark timestamp. This is faster and recommended for regular syncs."
              }
              disabled={canExecute}
              alwaysShow={canExecute}
            >
              <button
                onClick={() => handleRunNow(false)}
                disabled={isRunning || !canExecute}
                style={{
                  width: '100%',
                  padding: '12px 24px',
                  background: isRunning || !canExecute ? 'rgb(var(--color-archive))' : 'rgb(var(--color-bark))',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: isRunning || !canExecute ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  transition: 'background 0.2s',
                }}
              >
                {isRunning ? (
                  <>
                    <Loader size={16} className="spin" />
                    Running…
                  </>
                ) : (
                  <>
                    <Play size={16} />
                    Run Now
                  </>
                )}
              </button>
            </Tooltip>

            {/* Secondary: Full Run */}
            <Tooltip
              content={
                !canForceFullSync
                  ? "You need the 'runs.force_full' permission to force a full run"
                  : "Full runs re-process all records from the source, ignoring the incremental sync watermark. Use when you suspect data drift or after schema changes. May take significantly longer than incremental runs."
              }
              disabled={canForceFullSync}
              alwaysShow={canForceFullSync}
            >
              <button
                onClick={handleFullResyncClick}
                disabled={isRunning || !canForceFullSync}
                style={{
                  width: '100%',
                  padding: '10px 20px',
                  background: 'white',
                  color: !canForceFullSync ? 'rgb(var(--color-archive))' : 'rgb(var(--color-archive))',
                  border: '1px solid #E6E4DF',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: isRunning || !canForceFullSync ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                  opacity: isRunning || !canForceFullSync ? 0.5 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!isRunning && canForceFullSync) {
                  e.currentTarget.style.background = 'rgb(var(--color-parchment-warm))';
                  e.currentTarget.style.borderColor = 'rgb(var(--color-stone))';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'white';
                e.currentTarget.style.borderColor = 'rgb(var(--color-lichen))';
              }}
            >
              Full Run
            </button>
            </Tooltip>
          </div>

          {/* View Details Link */}
          {currentRun && (
            <div style={{ marginTop: '12px', textAlign: 'center' }}>
              <a
                href={`/organizations/${organizationId}/bridge/runs/${currentRun.run_id}`}
                style={{
                  fontSize: '13px',
                  color: 'rgb(var(--color-bark))',
                  textDecoration: 'none',
                }}
              >
                View run details →
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Full Run Confirmation Dialog */}
      {showFullResyncConfirm && (
        <>
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.6)',
              zIndex: 1001,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onClick={handleFullResyncCancel}
          />
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'white',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '440px',
              width: '90%',
              zIndex: 1002,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            }}
          >
            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
              <AlertCircle size={24} style={{ color: 'rgb(var(--color-warning))', flexShrink: 0 }} />
              <div>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 600, color: '#111827' }}>
                  Confirm Full Run
                </h3>
                <p style={{ margin: 0, fontSize: '14px', color: 'rgb(var(--color-archive))', lineHeight: '1.5' }}>
                  This will re-import all records and may take several hours. Use only if you suspect data drift. Continue?
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button
                onClick={handleFullResyncCancel}
                style={{
                  padding: '8px 16px',
                  background: 'white',
                  color: 'rgb(var(--color-accessible-gray))',
                  border: '1px solid #E6E4DF',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgb(var(--color-parchment-warm))'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
              >
                Cancel
              </button>
              <button
                onClick={handleFullResyncConfirm}
                style={{
                  padding: '8px 16px',
                  background: 'rgb(var(--color-warning))',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#d97706'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'rgb(var(--color-warning))'}
              >
                Continue Full Run
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
