import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { X, Play, ChevronDown, ChevronUp, Loader, CheckCircle, AlertCircle, Save, ExternalLink, Lock } from 'lucide-react';
import { getDatasets, getPipelines, createRun, executeRun, getRun, getConnectorInstance, updateConnectorInstance } from '../lib/api';
import { formatRelativeTime, getStatusLabel, isTerminalStatus } from '../lib/utils';
import type { Run, Dataset, ConnectorInstance } from '../lib/schemas';
import { usePermissions } from '../hooks/usePermissions';
import { canEditConnectorSettings } from '../lib/connectorPermissions';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useAccessibleModal, getModalAriaProps } from '../hooks/useAccessibleModal';
import { logger } from '../lib/logger';

interface SourceConnectorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  connectorName: string;
  connectorInstanceId: string;
  organizationId: string;
  pipelineId: string;
  datasetId: string | null;
  latestRun: Run | null;
  onRunComplete: (run: Run) => void;
}

export default function SourceConnectorDrawer({
  isOpen,
  onClose,
  connectorName,
  connectorInstanceId,
  organizationId,
  pipelineId,
  datasetId: _datasetId,
  latestRun,
  onRunComplete,
}: SourceConnectorDrawerProps) {
  const { isMobile } = useBreakpoint();
  const { modalRef, titleId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'source-connector-drawer',
  });
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loadingDatasets, setLoadingDatasets] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [currentRun, setCurrentRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectorDetails, setConnectorDetails] = useState<ConnectorInstance | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [editedConfig, setEditedConfig] = useState<Record<string, any>>({});
  const [editedName, setEditedName] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showFullResyncConfirm, setShowFullResyncConfirm] = useState(false);

  // Use refs for interval ID and callbacks to avoid stale closures
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onRunCompleteRef = useRef(onRunComplete);
  onRunCompleteRef.current = onRunComplete;

  const { hasPermission } = usePermissions();
  const hasEditPermission = hasPermission('connectors.edit');
  const canExecute = hasPermission('runs.execute');
  const canForceFullSync = hasPermission('runs.force_full');
  const editCapabilities = canEditConnectorSettings(hasEditPermission);

  // Single polling function — clears any existing interval before starting
  const startPolling = useCallback((runId: string, orgId: string) => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    pollingIntervalRef.current = setInterval(async () => {
      try {
        const updatedRun = await getRun(runId, orgId);
        setCurrentRun(updatedRun);

        if (isTerminalStatus(updatedRun.status)) {
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          setIsRunning(false);
          onRunCompleteRef.current(updatedRun);
        }
      } catch (err) {
        logger.error('Polling error:', err);
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        setIsRunning(false);
        setError(err instanceof Error ? err.message : 'Failed to check run status');
      }
    }, 2000);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // Sync with active run when drawer opens or latestRun changes
  useEffect(() => {
    if (isOpen && latestRun && !isTerminalStatus(latestRun.status)) {
      setIsRunning(true);
      setCurrentRun(latestRun);

      // Start polling if not already polling
      if (!pollingIntervalRef.current) {
        startPolling(latestRun.run_id, organizationId);
      }
    } else if (isOpen && latestRun && isTerminalStatus(latestRun.status)) {
      setIsRunning(false);
    }
  }, [isOpen, latestRun, organizationId, startPolling]);

  // Fetch datasets when drawer opens - filter to only those connected to this source connector
  useEffect(() => {
    if (isOpen && organizationId && connectorInstanceId) {
      setLoadingDatasets(true);
      Promise.all([
        getDatasets(organizationId),
        getPipelines(organizationId)
      ])
        .then(([allDatasets, allPipelines]) => {
          // Find all pipelines where this connector is a source
          const pipelinesWithThisSource = allPipelines.filter(pipeline =>
            pipeline.sources?.some(source => source.connector_instance_id === connectorInstanceId)
          );

          // Get unique dataset IDs from those pipelines
          const datasetIds = new Set(
            pipelinesWithThisSource
              .map(pipeline => pipeline.dataset_id)
              .filter((id): id is string => id !== null)
          );

          // Filter datasets to only those connected to this source connector
          const filteredData = allDatasets.filter(d => datasetIds.has(d.dataset_id));
          setDatasets(filteredData);
        })
        .catch((err) => logger.error('Failed to fetch datasets:', err))
        .finally(() => setLoadingDatasets(false));
    }
  }, [isOpen, organizationId, connectorInstanceId]);

  // Fetch connector details when settings expanded
  useEffect(() => {
    if (showSettings && connectorInstanceId && !connectorDetails) {
      setLoadingSettings(true);
      getConnectorInstance(connectorInstanceId)
        .then((data) => {
          setConnectorDetails(data);
          setEditedConfig(data.config || {});
          setEditedName(data.name);
        })
        .catch((err) => logger.error('Failed to fetch connector details:', err))
        .finally(() => setLoadingSettings(false));
    }
  }, [showSettings, connectorInstanceId, connectorDetails]);

  // Stop polling when drawer closes (unless run is still in progress)
  useEffect(() => {
    if (!isOpen && !isRunning) {
      stopPolling();
    }
  }, [isOpen, isRunning, stopPolling]);

  // Clean up polling on unmount — ref-based, always has current interval ID
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, []);

  const handleSaveSettings = async () => {
    if (!connectorInstanceId || !connectorDetails) return;
    
    try {
      setSaveError(null);
      setSaveSuccess(false);
      const updated = await updateConnectorInstance(connectorInstanceId, {
        name: editedName,
        config: editedConfig,
      });
      setConnectorDetails(updated);
      setIsEditing(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      logger.error('Failed to save connector settings:', err);
      setSaveError('Failed to save settings. Please try again.');
    }
  };

  const handleCancelEdit = () => {
    if (connectorDetails) {
      setEditedConfig(connectorDetails.config || {});
      setEditedName(connectorDetails.name);
    }
    setIsEditing(false);
    setSaveError(null);
  };

  const handleConfigChange = (key: string, value: string) => {
    setEditedConfig(prev => {
      // Convert to number if the value is numeric
      const numValue = Number(value);
      const finalValue = value !== '' && !isNaN(numValue) && /^\d+$/.test(value) ? numValue : value;
      return { ...prev, [key]: finalValue };
    });
  };

  const handleRunNow = async (forceFullSync = false) => {
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
      startPolling(executingRun.run_id, organizationId);
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
  
  // Check if there's an active run (not just local isRunning state)
  const hasActiveRun = displayRun ? !isTerminalStatus(displayRun.status) : false;
  const buttonsDisabled = hasActiveRun || isRunning;

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
          top: isMobile ? 'auto' : 0,
          right: isMobile ? 0 : 0,
          bottom: 0,
          left: isMobile ? 0 : 'auto',
          width: isMobile ? '100%' : '400px',
          maxWidth: isMobile ? '100%' : '90vw',
          maxHeight: isMobile ? '90vh' : '100vh',
          background: 'white',
          boxShadow: isMobile ? '0 -4px 12px rgba(0, 0, 0, 0.15)' : '-4px 0 12px rgba(0, 0, 0, 0.15)',
          borderRadius: isMobile ? '12px 12px 0 0' : 0,
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Drag handle for mobile */}
        {isMobile && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: '12px 0 8px',
            }}
          >
            <div
              style={{
                width: '36px',
                height: '4px',
                background: 'rgb(var(--color-stone))',
                borderRadius: '2px',
              }}
            />
          </div>
        )}

        {/* Header */}
        <div
          style={{
            padding: isMobile ? '12px 16px 16px' : '20px 24px',
            borderBottom: '1px solid #E6E4DF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h2 id={titleId} style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
            {connectorName}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close drawer"
            style={{
              background: 'none',
              border: 'none',
              padding: isMobile ? '10px' : '4px',
              minWidth: isMobile ? '44px' : 'auto',
              minHeight: isMobile ? '44px' : 'auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'rgb(var(--color-archive))',
              marginRight: isMobile ? '-10px' : 0,
            }}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px' : '24px', WebkitOverflowScrolling: 'touch' }}>
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

          {/* Datasets */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '13px', color: 'rgb(var(--color-archive))', marginBottom: '8px' }}>
              Datasets
            </div>
            {loadingDatasets ? (
              <div style={{ padding: '12px', textAlign: 'center', color: 'rgb(var(--color-archive))', fontSize: '14px' }}>
                <Loader size={16} className="spin" style={{ display: 'inline-block', marginRight: '8px' }} />
                Loading datasets...
              </div>
            ) : datasets.length === 0 ? (
              <div
                style={{
                  padding: '12px',
                  background: 'rgb(var(--color-parchment-warm))',
                  border: '1px solid #E6E4DF',
                  borderRadius: '8px',
                  fontSize: '14px',
                  color: 'rgb(var(--color-archive))',
                }}
              >
                No datasets configured yet
              </div>
            ) : (
              <div
                style={{
                  background: 'rgb(var(--color-parchment-warm))',
                  border: '1px solid #E6E4DF',
                  borderRadius: '8px',
                  overflow: 'hidden',
                }}
              >
                {datasets.map((dataset, index) => (
                  <div
                    key={dataset.dataset_id}
                    style={{
                      padding: '12px',
                      borderTop: index > 0 ? '1px solid #E6E4DF' : 'none',
                    }}
                  >
                    <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '2px' }}>
                      {dataset.name}
                    </div>
                    {dataset.description && (
                      <div style={{ fontSize: '13px', color: 'rgb(var(--color-archive))' }}>
                        {dataset.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Last Run */}
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
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '14px', color: 'rgb(var(--color-archive))' }}>Status</span>
                  <span style={{ fontSize: '14px', fontWeight: 500 }}>
                    {getStatusLabel(displayRun.status)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '14px', color: 'rgb(var(--color-archive))' }}>Time</span>
                  <span style={{ fontSize: '14px' }}>
                    {formatRelativeTime(displayRun.started_at || displayRun.finished_at || '')}
                  </span>
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
                </div>
              </div>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '12px' }}>
            {/* Primary: Run Now */}
            <button
              onClick={() => handleRunNow(false)}
              disabled={buttonsDisabled || !canExecute}
              style={{
                width: '100%',
                padding: '12px 24px',
                background: buttonsDisabled || !canExecute ? 'rgb(var(--color-archive))' : 'rgb(var(--color-bark))',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: buttonsDisabled || !canExecute ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'background 0.2s',
              }}
            >
              {hasActiveRun ? (
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

            {/* Secondary: Full Resync */}
            <button
              onClick={handleFullResyncClick}
              disabled={buttonsDisabled || !canForceFullSync}
              style={{
                width: '100%',
                padding: '10px 20px',
                background: 'white',
                color: !canForceFullSync ? 'rgb(var(--color-archive))' : 'rgb(var(--color-archive))',
                border: '1px solid #E6E4DF',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: buttonsDisabled || !canForceFullSync ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                opacity: buttonsDisabled || !canForceFullSync ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                if (!buttonsDisabled && canForceFullSync) {
                  e.currentTarget.style.background = 'rgb(var(--color-parchment-warm))';
                  e.currentTarget.style.borderColor = 'rgb(var(--color-stone))';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'white';
                e.currentTarget.style.borderColor = 'rgb(var(--color-lichen))';
              }}
            >
              Full Resync
            </button>
          </div>

          {/* Connection Properties Toggle */}
          {connectorInstanceId && (
            <button
              onClick={() => setShowSettings(!showSettings)}
              aria-expanded={showSettings}
              aria-controls="connector-settings-section"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '10px',
                fontSize: '13px',
                color: 'rgb(var(--color-archive))',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                transition: 'color 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'rgb(var(--color-accessible-gray))'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'rgb(var(--color-archive))'}
            >
              {showSettings ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
              {showSettings ? 'Hide' : 'View'} connection properties
            </button>
          )}

          {/* Expanded Settings Section */}
          {showSettings && (
            <div
              id="connector-settings-section"
              style={{
                marginTop: '16px',
                padding: '16px',
                background: 'rgb(var(--color-parchment-warm))',
                border: '1px solid #E6E4DF',
                borderRadius: '8px',
              }}
            >
              {loadingSettings ? (
                <div style={{ textAlign: 'center', padding: '16px', color: 'rgb(var(--color-archive))' }}>
                  <Loader size={16} className="animate-spin" style={{ display: 'inline-block' }} />
                  <span style={{ marginLeft: '8px', fontSize: '14px' }}>Loading properties...</span>
                </div>
              ) : connectorDetails ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>
                      Connection Properties
                    </h4>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <Link
                        to={`/organizations/${organizationId}/bridge/setup/connectors/${connectorInstanceId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          padding: '4px 12px',
                          fontSize: '12px',
                          background: 'white',
                          color: 'rgb(var(--color-bark))',
                          border: '1px solid #B0533A',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          textDecoration: 'none',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <ExternalLink size={12} />
                        Full Settings
                      </Link>
                      {!isEditing && editCapabilities.canEditMetadata && (
                        <button
                          onClick={() => setIsEditing(true)}
                          style={{
                            padding: '4px 12px',
                            fontSize: '12px',
                            background: 'rgb(var(--color-bark))',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                          }}
                        >
                          Edit
                        </button>
                      )}
                      {!isEditing && !editCapabilities.canEditMetadata && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'rgb(var(--color-archive))' }}>
                          <Lock size={12} />
                          Locked
                        </div>
                      )}
                    </div>
                  </div>

                  {saveSuccess && (
                    <div style={{ padding: '8px 12px', marginBottom: '12px', background: '#dcfce7', border: '1px solid #86efac', borderRadius: '4px', fontSize: '13px', color: 'rgb(var(--color-success))' }}>
                      Settings saved
                    </div>
                  )}

                  {saveError && (
                    <div style={{ padding: '8px 12px', marginBottom: '12px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '4px', fontSize: '13px', color: 'rgb(var(--color-error))' }}>
                      {saveError}
                    </div>
                  )}
                  
                  {editCapabilities.lockReason && (
                    <div style={{ padding: '8px 12px', marginBottom: '12px', background: 'rgb(var(--color-warning))', border: '1px solid #fde68a', borderRadius: '4px', fontSize: '12px', color: 'rgb(var(--color-warning))', display: 'flex', alignItems: 'start', gap: '6px' }}>
                      <Lock size={12} style={{ marginTop: '2px', flexShrink: 0 }} />
                      <span>{editCapabilities.lockReason}</span>
                    </div>
                  )}
                  
                  <div style={{ marginBottom: '12px' }}>
                    <label htmlFor="source-connector-name" style={{ fontSize: '12px', color: 'rgb(var(--color-archive))', marginBottom: '4px', display: 'block' }}>
                      Connection Name
                    </label>
                    {isEditing ? (
                      <input
                        id="source-connector-name"
                        type="text"
                        value={editedName}
                        onChange={(e) => setEditedName(e.target.value)}
                        aria-label="Connection Name"
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          fontSize: '14px',
                          border: '1px solid #E6E4DF',
                          borderRadius: '4px',
                        }}
                      />
                    ) : (
                      <div style={{ fontSize: '14px', fontWeight: 500 }}>
                        {connectorDetails.name}
                      </div>
                    )}
                  </div>

                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '12px', color: 'rgb(var(--color-archive))', marginBottom: '4px' }}>
                      Type
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 500 }}>
                      {connectorDetails.connector_definition_id}
                    </div>
                  </div>

                  {Object.keys(editedConfig).length > 0 && (
                    <div>
                      <div style={{ fontSize: '12px', color: 'rgb(var(--color-archive))', marginBottom: '8px' }}>
                        Configuration
                      </div>
                      <div
                        style={{
                          background: 'white',
                          border: '1px solid #E6E4DF',
                          borderRadius: '4px',
                          padding: '8px',
                          maxHeight: '200px',
                          overflowY: 'auto',
                        }}
                      >
                        {Object.entries(editedConfig).map(([key, value]) => (
                          <div key={key} style={{ marginBottom: '8px' }}>
                            <label htmlFor={`source-config-${key}`} style={{ fontSize: '12px', color: 'rgb(var(--color-archive))', display: 'block', marginBottom: '2px' }}>
                              {key}
                            </label>
                            {isEditing ? (
                              <input
                                id={`source-config-${key}`}
                                type="text"
                                value={typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                onChange={(e) => handleConfigChange(key, e.target.value)}
                                aria-label={key}
                                style={{
                                  width: '100%',
                                  padding: '4px 6px',
                                  fontSize: '13px',
                                  fontFamily: 'monospace',
                                  border: '1px solid #E6E4DF',
                                  borderRadius: '4px',
                                }}
                              />
                            ) : (
                              <div style={{ fontSize: '13px', fontFamily: 'monospace', color: 'rgb(var(--color-accessible-gray))' }}>
                                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {isEditing && (
                    <div style={{ marginTop: '16px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                      <button
                        onClick={handleCancelEdit}
                        style={{
                          padding: '6px 16px',
                          fontSize: '13px',
                          background: 'white',
                          color: 'rgb(var(--color-archive))',
                          border: '1px solid #E6E4DF',
                          borderRadius: '4px',
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveSettings}
                        style={{
                          padding: '6px 16px',
                          fontSize: '13px',
                          background: 'rgb(var(--color-bark))',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <Save size={14} />
                        Save Changes
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: '14px', color: 'rgb(var(--color-archive))' }}>
                  Unable to load connection properties.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Full Resync Confirmation Dialog */}
      {showFullResyncConfirm && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1001,
          }}
          onClick={handleFullResyncCancel}
        >
          <div
            style={{
              background: 'white',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '400px',
              width: '90%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', fontWeight: 600 }}>
              Confirm Full Resync
            </h3>
            <p style={{ margin: '0 0 20px 0', fontSize: '14px', color: 'rgb(var(--color-archive))', lineHeight: '1.5' }}>
              This will re-sync all data from the source, ignoring the incremental sync timestamp.
              This may take longer and process more records.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={handleFullResyncCancel}
                style={{
                  padding: '8px 16px',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: 'rgb(var(--color-archive))',
                  background: 'white',
                  border: '1px solid #E6E4DF',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleFullResyncConfirm}
                style={{
                  padding: '8px 16px',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: 'white',
                  background: 'rgb(var(--color-bark))',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Continue Full Resync
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
