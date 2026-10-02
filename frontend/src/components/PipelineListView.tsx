import { useState } from 'react';
import { ChevronDown, ChevronRight, ArrowRight, Loader, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import type { Pipeline, ConnectorInstance, Dataset, Run } from '../lib/schemas';
import { getStatusLabel } from '../lib/utils';
import { formatRelativeTime, formatNumber } from '../lib/formatters';

interface PipelineListViewProps {
  pipelines: Pipeline[];
  connectors: ConnectorInstance[];
  datasets: Dataset[];
  runsByPipeline: Map<string, Run>;
  activeRunsByPipeline: Map<string, boolean>;
  onSourceClick: (connectorId: string) => void;
  onDestinationClick: (connectorId: string) => void;
  onDatasetClick: (datasetId: string) => void;
}

/**
 * Mobile-friendly list view of pipelines as an alternative to the flow canvas.
 * Shows each pipeline as an expandable card with source, dataset, and destination info.
 */
export function PipelineListView({
  pipelines,
  connectors,
  datasets,
  runsByPipeline,
  activeRunsByPipeline,
  onSourceClick,
  onDestinationClick,
  onDatasetClick,
}: PipelineListViewProps) {
  const [expandedPipelineId, setExpandedPipelineId] = useState<string | null>(null);

  const getConnectorName = (connectorId: string) => {
    return connectors.find(c => c.connector_instance_id === connectorId)?.name || 'Unknown';
  };

  const getDatasetName = (datasetId: string | null | undefined) => {
    if (!datasetId) return 'No dataset';
    return datasets.find(d => d.dataset_id === datasetId)?.name || 'Unknown';
  };

  const getDataset = (datasetId: string | null | undefined) => {
    if (!datasetId) return null;
    return datasets.find(d => d.dataset_id === datasetId) || null;
  };

  const getStatusIcon = (run: Run | undefined, isActive: boolean) => {
    if (isActive) {
      return (
        <span role="status" aria-label="Running">
          <Loader size={14} className="spin" style={{ color: 'rgb(var(--color-success))' }} aria-hidden="true" />
          <span className="sr-only">Running</span>
        </span>
      );
    }
    if (!run) {
      return (
        <span aria-label="No runs yet">
          <Clock size={14} style={{ color: 'rgb(var(--color-archive))' }} aria-hidden="true" />
          <span className="sr-only">No runs yet</span>
        </span>
      );
    }
    if (run.status === 'success') {
      return (
        <span aria-label="Success">
          <CheckCircle size={14} style={{ color: 'rgb(var(--color-success))' }} aria-hidden="true" />
          <span className="sr-only">Success</span>
        </span>
      );
    }
    if (run.status === 'failed') {
      return (
        <span aria-label="Failed">
          <AlertCircle size={14} style={{ color: 'rgb(var(--color-error))' }} aria-hidden="true" />
          <span className="sr-only">Failed</span>
        </span>
      );
    }
    return (
      <span aria-label="Pending">
        <Clock size={14} style={{ color: 'rgb(var(--color-archive))' }} aria-hidden="true" />
        <span className="sr-only">Pending</span>
      </span>
    );
  };

  if (pipelines.length === 0) {
    return (
      <div
        style={{
          padding: '32px 16px',
          textAlign: 'center',
          color: 'rgb(var(--color-archive))',
          fontFamily: 'Georgia, serif',
          fontSize: '14px',
        }}
      >
        No pipelines configured
      </div>
    );
  }

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {pipelines.map((pipeline) => {
        const pipelineId = pipeline.pipeline_id;
        const isExpanded = expandedPipelineId === pipelineId;
        const run = runsByPipeline.get(pipelineId);
        const isActive = activeRunsByPipeline.get(pipelineId) || false;
        const dataset = getDataset(pipeline.dataset_id);
        const sourceCount = pipeline.sources?.length || 0;
        const destCount = pipeline.destinations?.length || 0;

        return (
          <div
            key={pipelineId}
            style={{
              background: 'rgb(var(--color-parchment-warm))',
              border: isActive ? '2px solid #4F6F5E' : '1px solid #E4DCCB',
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            {/* Header - always visible */}
            <button
              onClick={() => setExpandedPipelineId(isExpanded ? null : pipelineId)}
              aria-expanded={isExpanded}
              aria-label={`Pipeline: ${getDatasetName(pipeline.dataset_id)}, ${sourceCount} source${sourceCount !== 1 ? 's' : ''}, ${destCount} destination${destCount !== 1 ? 's' : ''}`}
              style={{
                width: '100%',
                padding: '14px 16px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                textAlign: 'left',
              }}
            >
              {/* Expand/collapse icon */}
              <div style={{ color: 'rgb(var(--color-archive))', flexShrink: 0 }} aria-hidden="true">
                {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              </div>

              {/* Pipeline summary */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '13px',
                    color: 'rgb(var(--color-archive))',
                    marginBottom: '4px',
                  }}
                >
                  <span>{sourceCount} source{sourceCount !== 1 ? 's' : ''}</span>
                  <ArrowRight size={12} />
                  <span>{destCount} dest{destCount !== 1 ? 's' : ''}</span>
                </div>
                <div
                  style={{
                    fontSize: '15px',
                    fontWeight: 600,
                    color: '#2C3639',
                    fontFamily: 'Georgia, serif',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {getDatasetName(pipeline.dataset_id)}
                </div>
              </div>

              {/* Status indicator */}
              <div style={{ flexShrink: 0 }}>
                {getStatusIcon(run, isActive)}
              </div>
            </button>

            {/* Expanded details */}
            {isExpanded && (
              <div
                style={{
                  padding: '0 16px 16px',
                  borderTop: '1px solid #E4DCCB',
                }}
              >
                {/* Dataset info */}
                {dataset && (
                  <button
                    onClick={() => onDatasetClick(dataset.dataset_id)}
                    style={{
                      width: '100%',
                      padding: '12px',
                      marginTop: '12px',
                      background: '#F9F8F6',
                      border: '1px solid #E4DCCB',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 500,
                        color: '#8B7355',
                        marginBottom: '4px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}
                    >
                      Dataset
                    </div>
                    <div
                      style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: '#2C3639',
                        marginBottom: '2px',
                      }}
                    >
                      {dataset.name}
                    </div>
                    <div style={{ fontSize: '12px', color: 'rgb(var(--color-archive))' }}>
                      {formatNumber(dataset.entity_count || 0)} entities
                    </div>
                  </button>
                )}

                {/* Sources */}
                {pipeline.sources && pipeline.sources.length > 0 && (
                  <div style={{ marginTop: '12px' }}>
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 500,
                        color: 'rgb(var(--color-archive))',
                        marginBottom: '8px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}
                    >
                      Sources
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {pipeline.sources.map((source) => (
                        <button
                          key={source.connector_instance_id}
                          onClick={() => onSourceClick(source.connector_instance_id)}
                          style={{
                            padding: '10px 12px',
                            background: 'rgb(var(--color-parchment-warm))',
                            border: '1px solid #E4DCCB',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontSize: '13px',
                            color: '#2C3639',
                            fontFamily: 'Georgia, serif',
                          }}
                        >
                          {getConnectorName(source.connector_instance_id)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Destinations */}
                {pipeline.destinations && pipeline.destinations.length > 0 && (
                  <div style={{ marginTop: '12px' }}>
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 500,
                        color: 'rgb(var(--color-archive))',
                        marginBottom: '8px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}
                    >
                      Destinations
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {pipeline.destinations.map((dest) => (
                        <button
                          key={dest.connector_instance_id}
                          onClick={() => onDestinationClick(dest.connector_instance_id)}
                          style={{
                            padding: '10px 12px',
                            background: 'rgb(var(--color-parchment-warm))',
                            border: '1px solid #E4DCCB',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontSize: '13px',
                            color: 'rgb(var(--color-archive))',
                            fontFamily: 'Georgia, serif',
                          }}
                        >
                          {getConnectorName(dest.connector_instance_id)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Last run info */}
                {run && (
                  <div
                    style={{
                      marginTop: '12px',
                      padding: '10px 12px',
                      background: '#F9F8F6',
                      borderRadius: '4px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ fontSize: '12px', color: 'rgb(var(--color-archive))' }}>Last run</div>
                    <div style={{ fontSize: '12px', color: '#2C3639', fontWeight: 500 }}>
                      {getStatusLabel(run.status)} • {formatRelativeTime(run.started_at || run.finished_at || '')}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
