import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  getConnectorDefinitions,
  getConnectorInstances,
  createConnectorInstance,
  deleteConnectorInstance,
  getOrganizations,
  getPipelines,
} from '../../lib/api';
import type { ConnectorDefinition } from '../../lib/schemas';
import { useToast } from '../../contexts/ToastContext';
import { useOrganization } from '../../contexts/useOrganization';
import ConfirmDialog from '../../components/ConfirmDialog';
import DatabaseConnectionWizard from '../../components/DatabaseConnectionWizard';
import ApiConnectionWizard from '../../components/ApiConnectionWizard';
import { ConnectorIcon } from '../../lib/connectorIcons';
import { Plug } from 'lucide-react';

export default function ConnectorsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;
  const navigate = useNavigate();
  const { showToast } = useToast();

  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [deleteConfirmInstance, setDeleteConfirmInstance] = useState<{ id: string; name: string } | null>(null);
  const [formData, setFormData] = useState({
    organization_id: organizationId || '',
    connector_definition_id: '',
    name: '',
    config: '{}',
  });

  // Wizard state
  const [wizardDefinition, setWizardDefinition] = useState<ConnectorDefinition | null>(null);
  const [apiWizardDefinition, setApiWizardDefinition] = useState<ConnectorDefinition | null>(null);

  const { data: definitions } = useQuery({
    queryKey: ['connector-definitions'],
    queryFn: getConnectorDefinitions,
  });

  const { data: instances } = useQuery({
    queryKey: ['connector-instances', organizationId],
    queryFn: () => getConnectorInstances(organizationId || undefined),
    enabled: !!organizationId,
  });

  const { data: organizations } = useQuery({
    queryKey: ['organizations'],
    queryFn: getOrganizations,
  });

  const { data: pipelines } = useQuery({
    queryKey: ['pipelines', organizationId],
    queryFn: () => getPipelines(organizationId || undefined),
    enabled: !!organizationId,
  });

  // Category display labels
  const categoryLabels: Record<string, string> = {
    database: 'Databases',
    api: 'APIs',
    file: 'File Systems',
    cloud: 'Cloud Services',
  };

  // Group definitions by category
  const groupedDefinitions = useMemo(() => {
    if (!definitions) return {};

    const groups: Record<string, typeof definitions> = {};

    for (const def of definitions) {
      const category = def.category || 'other';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(def);
    }

    // Sort categories: database, api, file, cloud, other
    const categoryOrder = ['database', 'api', 'file', 'cloud', 'other'];
    const sortedGroups: Record<string, typeof definitions> = {};

    for (const cat of categoryOrder) {
      if (groups[cat]) {
        sortedGroups[cat] = groups[cat];
      }
    }

    // Add any categories not in the order
    for (const cat of Object.keys(groups)) {
      if (!sortedGroups[cat]) {
        sortedGroups[cat] = groups[cat];
      }
    }

    return sortedGroups;
  }, [definitions]);

  const createMutation = useMutation({
    mutationFn: createConnectorInstance,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connector-instances'] });
      setShowCreateForm(false);
      setFormData({
        organization_id: '',
        connector_definition_id: '',
        name: '',
        config: '{}',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteConnectorInstance,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connector-instances'] });
    },
  });

  const handleConfirmDelete = () => {
    if (deleteConfirmInstance) {
      deleteMutation.mutate(deleteConfirmInstance.id);
      setDeleteConfirmInstance(null);
    }
  };

  const handleCreate = () => {
    try {
      const config = JSON.parse(formData.config);
      createMutation.mutate({
        ...formData,
        config,
      });
    } catch {
      showToast({ type: 'error', title: 'Error', message: 'Invalid JSON in config field' });
    }
  };

  // Launch wizard for database connectors
  const handleLaunchWizard = (def: ConnectorDefinition) => {
    setWizardDefinition(def);
  };

  // Handle wizard completion
  const handleWizardComplete = (instanceId: string) => {
    setWizardDefinition(null);
    queryClient.invalidateQueries({ queryKey: ['connector-instances'] });
    // Navigate to the new connector's settings page
    navigate(`/organizations/${organizationId}/bridge/setup/connectors/${instanceId}`);
  };

  // Check if a definition is a database connector
  const isDatabaseConnector = (def: ConnectorDefinition) => def.key?.startsWith('db-');

  // Check if a definition is an API connector
  const isApiConnector = (def: ConnectorDefinition) => def.category === 'api';

  // Launch wizard for API connectors
  const handleLaunchApiWizard = (def: ConnectorDefinition) => {
    setApiWizardDefinition(def);
  };

  // Handle API wizard completion
  const handleApiWizardComplete = (instanceId: string) => {
    setApiWizardDefinition(null);
    queryClient.invalidateQueries({ queryKey: ['connector-instances'] });
    navigate(`/organizations/${organizationId}/bridge/setup/connectors/${instanceId}`);
  };

  return (
    <div className="max-w-6xl mx-auto p-8">

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Plug className="w-6 h-6 text-forest" style={{ opacity: 0.6 }} />
            <h1 className="text-2xl font-semibold text-ink">Connectors</h1>
          </div>
        </div>

      {/* Connector Types (Read-only) - Grouped by Category */}
      <div className="bg-parchment rounded-lg shadow">
        <div className="px-6 py-4 border-b border-lichen">
          <h2 className="text-xl font-semibold text-ink">Connector Types</h2>
          <p className="text-sm text-archive mt-1">Available connector types (read-only)</p>
        </div>
        <div className="p-6 space-y-8">
          {Object.entries(groupedDefinitions).map(([category, defs]) => (
            <div key={category}>
              <h3 className="text-lg font-semibold text-ink mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-stone"></span>
                {categoryLabels[category] || category.charAt(0).toUpperCase() + category.slice(1)}
                <span className="text-sm font-normal text-archive">({defs.length})</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {defs.map((def) => (
                  <div key={def.connector_definition_id} className="border border-lichen rounded-lg p-4 hover:border-stone transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 p-2 bg-lichen rounded-lg">
                        <ConnectorIcon connectorKey={def.key} category={def.category ?? undefined} size={28} className="text-archive" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <h3 className="font-semibold text-ink truncate">{def.display_name}</h3>
                          <span
                            className={`flex-shrink-0 px-2 py-0.5 text-xs font-medium rounded ${
                              def.direction === 'source'
                                ? 'bg-semantic-info/10 text-semantic-info'
                                : def.direction === 'target'
                                ? 'bg-semantic-success/10 text-semantic-success'
                                : 'bg-archive/10 text-archive'
                            }`}
                          >
                            {def.direction}
                          </span>
                        </div>
                        <p className="text-xs text-archive truncate mb-2">Key: {def.key}</p>

                        {/* Connect button for database connectors */}
                        {isDatabaseConnector(def) && organizationId && (
                          <button
                            onClick={() => handleLaunchWizard(def)}
                            className="w-full mt-2 px-3 py-1.5 bg-bark text-parchment text-sm rounded hover:bg-copper-dark hover:text-parchment transition-colors"
                          >
                            Connect
                          </button>
                        )}

                        {/* Connect button for API connectors */}
                        {isApiConnector(def) && organizationId && (
                          <button
                            onClick={() => handleLaunchApiWizard(def)}
                            className="w-full mt-2 px-3 py-1.5 bg-bark text-parchment text-sm rounded hover:bg-copper-dark hover:text-parchment transition-colors"
                          >
                            Connect
                          </button>
                        )}

                        {def.config_schema && (
                          <details className="mt-2">
                            <summary className="text-sm text-bark cursor-pointer hover:text-copper-dark">View schema</summary>
                            <pre className="mt-2 text-xs bg-lichen p-2 rounded overflow-x-auto max-h-48">
                              {JSON.stringify(def.config_schema, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Configured Systems (CRUD) */}
      <div className="bg-parchment rounded-lg shadow">
        <div className="px-6 py-4 border-b border-lichen flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-ink">Configured Systems</h2>
            <p className="text-sm text-archive mt-1">Configured connectors for your organizations</p>
          </div>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="btn-primary text-sm"
          >
            {showCreateForm ? 'Cancel' : 'Create Instance'}
          </button>
        </div>

        {/* Create Form */}
        {showCreateForm && (
          <div className="p-6 border-b border-lichen bg-lichen">
            <h3 className="font-semibold text-ink mb-4">New Connector Instance</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="connector-organization" className="block text-sm font-medium text-ink mb-1">Organization</label>
                <select
                  id="connector-organization"
                  value={formData.organization_id}
                  onChange={(e) => setFormData({ ...formData, organization_id: e.target.value })}
                  className="w-full border border-lichen rounded-md px-3 py-2"
                >
                  <option value="">Select Organization</option>
                  {organizations?.map((organization) => (
                    <option key={organization.organization_id} value={organization.organization_id}>
                      {organization.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink mb-2">
                  Connector Definition
                </label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {definitions?.map((def) => (
                    <button
                      key={def.connector_definition_id}
                      type="button"
                      onClick={() => setFormData({ ...formData, connector_definition_id: def.connector_definition_id })}
                      className={`flex items-center gap-2 p-2 border rounded-lg text-left transition-all ${
                        formData.connector_definition_id === def.connector_definition_id
                          ? 'border-bark bg-bark/10 ring-1 ring-bark/20'
                          : 'border-lichen hover:border-stone hover:bg-lichen'
                      }`}
                    >
                      <ConnectorIcon connectorKey={def.key} category={def.category ?? undefined} size={20} className="flex-shrink-0 text-archive" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-ink truncate">{def.display_name}</div>
                        <div className="text-xs text-archive">{def.direction}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="connector-name" className="block text-sm font-medium text-ink mb-1">Name</label>
                <input
                  id="connector-name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="My Smithsonian Source"
                  className="w-full border border-lichen rounded-md px-3 py-2"
                  aria-label="Connector instance name"
                />
              </div>

              <div>
                <label htmlFor="connector-config" className="block text-sm font-medium text-ink mb-1">
                  Config (JSON)
                </label>
                <textarea
                  id="connector-config"
                  value={formData.config}
                  onChange={(e) => setFormData({ ...formData, config: e.target.value })}
                  onPaste={(e) => {
                    // Preserve escape sequences like \n when pasting JSON
                    e.preventDefault();
                    const pastedText = e.clipboardData.getData('text');
                    const textarea = e.currentTarget;
                    const start = textarea.selectionStart;
                    const end = textarea.selectionEnd;
                    const newValue = formData.config.substring(0, start) + pastedText + formData.config.substring(end);
                    setFormData({ ...formData, config: newValue });
                  }}
                  rows={8}
                  className="w-full border border-lichen rounded-md px-3 py-2 font-mono text-sm"
                  placeholder='{"api_key": "...", "endpoint": "..."}'
                  aria-label="Connector configuration JSON"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleCreate}
                  disabled={
                    !formData.organization_id ||
                    !formData.connector_definition_id ||
                    !formData.name ||
                    createMutation.isPending
                  }
                  className="btn-primary"
                >
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </button>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="btn-tertiary"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Instances List */}
        <div className="p-6">
          <div className="space-y-4">
            {instances?.map((instance, _index) => {
              const definition = definitions?.find(
                (d) => d.connector_definition_id === instance.connector_definition_id
              );
              return (
                <Link
                  key={instance.connector_instance_id}
                  to={`/organizations/${organizationId}/bridge/setup/connectors/${instance.connector_instance_id}`}
                  className="block border border-lichen rounded-lg p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  style={{
                    textDecoration: 'none',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#fafaf9';
                    e.currentTarget.style.borderColor = '#a8a29e';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '';
                    e.currentTarget.style.borderColor = 'rgb(var(--color-lichen))';
                  }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="flex-shrink-0 p-2 bg-lichen rounded-lg">
                        <ConnectorIcon connectorKey={definition?.key} category={definition?.category ?? undefined} size={24} className="text-archive" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-ink">{instance.name}</h3>
                          {definition && (
                            <span
                              className={`px-2 py-0.5 text-xs font-medium rounded ${
                                definition.direction === 'source'
                                  ? 'bg-semantic-info/10 text-semantic-info'
                                  : definition.direction === 'target'
                                  ? 'bg-semantic-success/10 text-semantic-success'
                                  : 'bg-archive/10 text-archive'
                              }`}
                            >
                              {definition.direction}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-archive">
                          {definition?.display_name || instance.connector_definition_id}
                        </p>
                        <p className="text-xs text-stone mt-1">
                          ID: {instance.connector_instance_id}
                        </p>
                        {/* Pipeline usage context */}
                        <p className="text-sm text-archive mt-2">
                          {(() => {
                            const pipelineCount = pipelines?.filter(
                              (p) =>
                                p.sources?.some(s => s.connector_instance_id === instance.connector_instance_id) ||
                                p.destinations?.some(d => d.connector_instance_id === instance.connector_instance_id)
                            ).length || 0;

                            if (pipelineCount === 0) {
                              return <span className="text-stone">Not used by any pipelines</span>;
                            }
                            return (
                              <span>
                                Used by <span className="font-medium">{pipelineCount}</span> {pipelineCount === 1 ? 'pipeline' : 'pipelines'}
                              </span>
                            );
                          })()}
                        </p>
                        <details className="mt-2" onClick={(e) => e.stopPropagation()}>
                          <summary className="text-sm text-bark cursor-pointer">
                            View config
                          </summary>
                          <pre className="mt-2 text-xs bg-lichen p-2 rounded overflow-x-auto">
                            {JSON.stringify(instance.config, null, 2)}
                          </pre>
                        </details>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDeleteConfirmInstance({
                          id: instance.connector_instance_id,
                          name: instance.name
                        });
                      }}
                      className="text-semantic-error hover:text-semantic-error/80 text-sm"
                    >
                      Delete
                    </button>
                  </div>
                </Link>
              );
            })}
            {instances?.length === 0 && (
              <p className="text-center text-archive py-8">
                No configured systems found. Create one to get started.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirmInstance !== null}
        onClose={() => setDeleteConfirmInstance(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Connector Instance"
        message={`Delete connector instance "${deleteConfirmInstance?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        confirmStyle="danger"
      />

      {/* Database Connection Wizard Modal */}
      {wizardDefinition && organizationId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50">
          <DatabaseConnectionWizard
            definition={wizardDefinition}
            organizationId={organizationId}
            onComplete={handleWizardComplete}
            onCancel={() => setWizardDefinition(null)}
          />
        </div>
      )}

      {/* API Connection Wizard Modal */}
      {apiWizardDefinition && organizationId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50">
          <ApiConnectionWizard
            definition={apiWizardDefinition}
            organizationId={organizationId}
            onComplete={handleApiWizardComplete}
            onCancel={() => setApiWizardDefinition(null)}
          />
        </div>
      )}
      </div>
    </div>
  );
}
