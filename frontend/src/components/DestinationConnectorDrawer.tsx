import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X, ChevronDown, ChevronUp, Loader, Save, ExternalLink, Lock } from 'lucide-react';
import { formatRelativeTime } from '../lib/utils';
import { getConnectorInstance, updateConnectorInstance } from '../lib/api';
import type { Run, ConnectorInstance } from '../lib/schemas';
import { usePermissions } from '../hooks/usePermissions';
import { canEditConnectorSettings } from '../lib/connectorPermissions';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useAccessibleModal, getModalAriaProps } from '../hooks/useAccessibleModal';
import { logger } from '../lib/logger';

interface DestinationConnectorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  connectorName: string;
  connectorType: string;
  connectorInstanceId: string;
  organizationId: string;
  latestRun: Run | null;
}

export default function DestinationConnectorDrawer({
  isOpen,
  onClose,
  connectorName,
  connectorType,
  connectorInstanceId,
  organizationId,
  latestRun,
}: DestinationConnectorDrawerProps) {
  const { isMobile } = useBreakpoint();
  const { modalRef, titleId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'destination-connector-drawer',
  });
  const [connectorDetails, setConnectorDetails] = useState<ConnectorInstance | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [editedConfig, setEditedConfig] = useState<Record<string, any>>({});
  const [editedName, setEditedName] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  
  const { hasPermission } = usePermissions();
  const hasEditPermission = hasPermission('connectors.edit');
  const editCapabilities = canEditConnectorSettings(hasEditPermission);

  // Fetch connector details when settings expanded
  useEffect(() => {
    if (showSettings && connectorInstanceId && !connectorDetails) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Loading state before async operation
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
    setEditedConfig(prev => ({ ...prev, [key]: value }));
  };

  if (!isOpen) return null;

  const lastPublished = latestRun?.published_at || latestRun?.finished_at;

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
          {/* Destination Type */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '13px', color: 'rgb(var(--color-archive))', marginBottom: '4px' }}>
              Destination type
            </div>
            <div style={{ fontSize: '14px', fontWeight: 500 }}>
              {connectorType}
            </div>
          </div>

          {/* Connection Properties Toggle */}
          {connectorInstanceId && (
            <div style={{ marginBottom: '24px' }}>
              <button
                onClick={() => setShowSettings(!showSettings)}
                aria-expanded={showSettings}
                aria-controls="destination-settings-section"
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '10px',
                  fontSize: '13px',
                  color: 'rgb(var(--color-bark))',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
                onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
              >
                {showSettings ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                {showSettings ? 'Hide' : 'View'} connection properties
              </button>

              {/* Expanded Settings Section */}
              {showSettings && (
                <div
                  id="destination-settings-section"
                  style={{
                    marginTop: '12px',
                    padding: '16px',
                    background: 'rgb(var(--color-parchment-warm))',
                    border: '1px solid #E6E4DF',
                    borderRadius: '8px',
                  }}
                >
                  {loadingSettings ? (
                    <div role="status" aria-live="polite" style={{ textAlign: 'center', padding: '16px', color: 'rgb(var(--color-archive))' }}>
                      <Loader size={16} className="animate-spin" style={{ display: 'inline-block' }} aria-hidden="true" />
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
                              border: '1px solid #D8D2C8',
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
                                background: 'rgb(var(--color-archive))',
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
                        <div role="status" aria-live="polite" style={{ padding: '8px 12px', marginBottom: '12px', background: '#dcfce7', border: '1px solid #86efac', borderRadius: '4px', fontSize: '13px', color: 'rgb(var(--color-success))' }}>
                          Settings saved
                        </div>
                      )}

                      {saveError && (
                        <div role="alert" aria-live="assertive" style={{ padding: '8px 12px', marginBottom: '12px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '4px', fontSize: '13px', color: 'rgb(var(--color-error))' }}>
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
                        <label htmlFor="dest-connector-name" style={{ fontSize: '12px', color: 'rgb(var(--color-archive))', marginBottom: '4px', display: 'block' }}>
                          Connection Name
                        </label>
                        {isEditing ? (
                          <input
                            id="dest-connector-name"
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
                                <label htmlFor={`dest-config-${key}`} style={{ fontSize: '12px', color: 'rgb(var(--color-archive))', display: 'block', marginBottom: '2px' }}>
                                  {key}
                                </label>
                                {isEditing ? (
                                  <input
                                    id={`dest-config-${key}`}
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
          )}

          {/* Downstream Representation */}
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '12px' }}>
              Downstream representation
            </h3>
            <div style={{ fontSize: '14px', color: 'rgb(var(--color-accessible-gray))', lineHeight: '1.6' }}>
              <p style={{ margin: '0 0 12px 0' }}>
                Canonical entities are published to the downstream system according to its native structure.
              </p>
              <p style={{ margin: '0' }}>
                Fields are mapped from Madrona's canonical entity model when the pipeline runs.
              </p>
            </div>
          </div>

          {/* Last Published State */}
          {lastPublished && (
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '13px', color: 'rgb(var(--color-archive))', marginBottom: '8px' }}>
                Last published state
              </div>
              <div
                style={{
                  background: 'rgb(var(--color-parchment-warm))',
                  border: '1px solid #E6E4DF',
                  borderRadius: '8px',
                  padding: '12px',
                }}
              >
                <div style={{ fontSize: '14px', fontWeight: 500, color: 'rgb(var(--color-accessible-gray))' }}>
                  Current as of {formatRelativeTime(lastPublished)}
                </div>
              </div>
            </div>
          )}

          {!lastPublished && (
            <div
              style={{
                padding: '16px',
                background: 'rgb(var(--color-parchment-warm))',
                border: '1px solid #E6E4DF',
                borderRadius: '8px',
                fontSize: '14px',
                color: 'rgb(var(--color-archive))',
                textAlign: 'center',
              }}
            >
              No entity state has been published.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
