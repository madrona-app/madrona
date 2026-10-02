import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { CheckCircle2, ArrowRight, ArrowLeft, Plug, Route as RouteIcon, Play, CheckSquare, Sparkles, AlertCircle, BookOpen } from 'lucide-react';
import { FaDatabase } from 'react-icons/fa';
import { ConnectorIcon } from '../../lib/connectorIcons';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import {
  getDatasets,
  getConnectorInstances,
  getConnectorDefinitions,
  getPipelines,
  getEntities,
  createDataset,
  createConnectorInstance,
  createPipeline,
} from '../../lib/api';
import { apiFetch } from '../../lib/apiClient';
import { useOrganization } from '../../contexts/useOrganization';
import { useState, useEffect, useMemo } from 'react';

interface WizardStep {
  id: string;
  number: number;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  isComplete: boolean;
}

export default function SetupWizardPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;
  const queryClient = useQueryClient();

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [hasInitialized, setHasInitialized] = useState(false);

  // Dataset form state
  const [datasetForm, setDatasetForm] = useState({
    name: '',
    key: '',
    description: '',
    source_type: '',
  });
  const [datasetErrors, setDatasetErrors] = useState<Record<string, string>>({});

  // Connector form state
  const [connectorForm, setConnectorForm] = useState({
    connector_definition_id: '',
    name: '',
    config: '{}',
  });
  const [connectorErrors, setConnectorErrors] = useState<Record<string, string>>({});

  // Pipeline form state
  const [pipelineForm, setPipelineForm] = useState({
    name: '',
    source_instance_id: '',
    target_instance_id: '',
    dataset_id: '',
  });
  const [pipelineErrors, setPipelineErrors] = useState<Record<string, string>>({});
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('');

  // Run state
  const [runType, setRunType] = useState<'test' | 'full'>('test');
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [runError, setRunError] = useState<string>('');

  // Fetch all required data
  const { data: datasets, isLoading: datasetsLoading, refetch: refetchDatasets } = useQuery({
    queryKey: ['datasets', organizationId],
    queryFn: () => getDatasets(organizationId!),
    enabled: !!organizationId,
  });

  const { data: connectorDefinitions, isLoading: definitionsLoading } = useQuery({
    queryKey: ['connector-definitions'],
    queryFn: getConnectorDefinitions,
    enabled: !!organizationId && (datasets?.length || 0) >= 1, // Only load after dataset step
  });

  const { data: connectorInstances, isLoading: connectorsLoading, refetch: refetchConnectors } = useQuery({
    queryKey: ['connector-instances', organizationId],
    queryFn: () => getConnectorInstances(organizationId || undefined),
    enabled: !!organizationId && (datasets?.length || 0) >= 1, // Only load after dataset step
  });

  const { data: pipelines, isLoading: pipelinesLoading, refetch: refetchPipelines } = useQuery({
    queryKey: ['pipelines', organizationId],
    queryFn: () => getPipelines(organizationId || undefined),
    enabled: !!organizationId && (connectorInstances?.length || 0) >= 1, // Only load after connector step
  });

  const { data: runsData, isLoading: runsLoading, refetch: refetchRuns } = useQuery({
    queryKey: ['runs', organizationId, 'success'],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: '1',
        offset: '0',
        status: 'success',
      });
      return await apiFetch(`/organizations/${organizationId}/bridge/runs?${params}`);
    },
    enabled: !!organizationId && (pipelines?.length || 0) >= 1, // Only load after pipeline step
  });

  const { data: entitiesData, isLoading: entitiesLoading } = useQuery({
    queryKey: ['entities', organizationId, 'setup-check'],
    queryFn: () => getEntities({ organization_id: organizationId!, limit: 1, offset: 0 }),
    enabled: !!organizationId && (pipelines?.length || 0) >= 1, // Only load after pipeline step
  });

  const isLoading = datasetsLoading || definitionsLoading || connectorsLoading || pipelinesLoading || runsLoading || entitiesLoading;

  // Category display labels
  const categoryLabels: Record<string, string> = {
    database: 'Databases',
    api: 'APIs',
    file: 'File Systems',
    cloud: 'Cloud Services',
  };

  // Group definitions by category
  const groupedDefinitions = useMemo(() => {
    if (!connectorDefinitions) return {};

    const groups: Record<string, typeof connectorDefinitions> = {};

    for (const def of connectorDefinitions) {
      const category = def.category || 'other';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(def);
    }

    // Sort categories: database, api, file, cloud, other
    const categoryOrder = ['database', 'api', 'file', 'cloud', 'other'];
    const sortedGroups: Record<string, typeof connectorDefinitions> = {};

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
  }, [connectorDefinitions]);

  // Mutations
  const createDatasetMutation = useMutation({
    mutationFn: createDataset,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['datasets'] });
      refetchDatasets();
      setDatasetForm({ name: '', key: '', description: '', source_type: '' });
      setDatasetErrors({});
    },
    onError: (error: any) => {
      setDatasetErrors({ submit: error?.message || 'Failed to create dataset' });
    },
  });

  const createConnectorMutation = useMutation({
    mutationFn: createConnectorInstance,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connector-instances'] });
      refetchConnectors();
      setConnectorForm({ connector_definition_id: '', name: '', config: '{}' });
      setConnectorErrors({});
    },
    onError: (error: any) => {
      setConnectorErrors({ submit: error?.message || 'Failed to create connector' });
    },
  });

  const createPipelineMutation = useMutation({
    mutationFn: createPipeline,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      refetchPipelines();
      setPipelineForm({ name: '', source_instance_id: '', target_instance_id: '', dataset_id: '' });
      setPipelineErrors({});
    },
    onError: (error: any) => {
      setPipelineErrors({ submit: error?.message || 'Failed to create pipeline' });
    },
  });

  // Build wizard steps
  const wizardSteps: WizardStep[] = [
    {
      id: 'welcome',
      number: 0,
      title: 'Welcome',
      description: 'Get started with Madrona',
      icon: Sparkles,
      isComplete: true,
    },
    {
      id: 'dataset',
      number: 1,
      title: 'Dataset',
      description: 'Create or select a dataset',
      icon: FaDatabase,
      isComplete: (datasets?.length || 0) >= 1,
    },
    {
      id: 'connector',
      number: 2,
      title: 'Connector',
      description: 'Configure a data connector',
      icon: Plug,
      isComplete: (connectorInstances?.length || 0) >= 1,
    },
    {
      id: 'route',
      number: 3,
      title: 'Pipeline',
      description: 'Define a data pipeline',
      icon: RouteIcon,
      isComplete: (pipelines?.length || 0) >= 1,
    },
    {
      id: 'run',
      number: 4,
      title: 'Run',
      description: 'Execute your pipeline',
      icon: Play,
      isComplete: (runsData?.total_count || 0) >= 1 && (entitiesData?.total || 0) >= 1,
    },
    {
      id: 'complete',
      number: 5,
      title: 'Complete',
      description: 'Setup finished',
      icon: CheckSquare,
      isComplete: true,
    },
  ];

  const currentStep = wizardSteps[currentStepIndex];

  // Auto-navigate to first incomplete step on initial load
  useEffect(() => {
    if (!isLoading && !hasInitialized) {
      const firstIncompleteIndex = wizardSteps.findIndex((step) => !step.isComplete);
      if (firstIncompleteIndex !== -1) {
        setCurrentStepIndex(firstIncompleteIndex);
      } else {
        setCurrentStepIndex(wizardSteps.length - 1);
      }
      setHasInitialized(true);
    }
  }, [isLoading, hasInitialized]);

  const canMoveForward = () => {
    if (currentStepIndex === 0) return true;
    if (currentStepIndex >= wizardSteps.length - 1) return false;
    return currentStep.isComplete;
  };

  const canMoveBackward = () => {
    return currentStepIndex > 0;
  };

  const handleNext = () => {
    if (canMoveForward()) {
      setCurrentStepIndex(currentStepIndex + 1);
    }
  };

  const handlePrevious = () => {
    if (canMoveBackward()) {
      setCurrentStepIndex(currentStepIndex - 1);
    }
  };

  const handleStepClick = (index: number) => {
    const furthestUnlocked = wizardSteps.findIndex((step, idx) => {
      if (idx === 0) return false;
      return !step.isComplete;
    });
    
    if (furthestUnlocked === -1) {
      setCurrentStepIndex(index);
      return;
    }
    
    if (index <= furthestUnlocked) {
      setCurrentStepIndex(index);
    }
  };

  // Dataset handlers
  const validateDatasetForm = () => {
    const errors: Record<string, string> = {};
    if (!datasetForm.name.trim()) errors.name = 'Name is required';
    if (!datasetForm.key.trim()) errors.key = 'Key is required';
    if (!datasetForm.source_type.trim()) errors.source_type = 'Source type is required';
    if (datasetForm.key && !/^[a-z0-9_-]+$/.test(datasetForm.key)) {
      errors.key = 'Key must be lowercase alphanumeric with hyphens or underscores';
    }
    setDatasetErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateDataset = () => {
    if (!validateDatasetForm()) return;
    createDatasetMutation.mutate({
      organization_id: organizationId!,
      name: datasetForm.name,
      key: datasetForm.key,
      description: datasetForm.description || undefined,
      source_type: datasetForm.source_type,
    });
  };

  // Connector handlers
  const validateConnectorForm = () => {
    const errors: Record<string, string> = {};
    if (!connectorForm.connector_definition_id) errors.connector_definition_id = 'Select a connector type';
    if (!connectorForm.name.trim()) errors.name = 'Name is required';
    try {
      JSON.parse(connectorForm.config);
    } catch {
      errors.config = 'Invalid JSON configuration';
    }
    setConnectorErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateConnector = () => {
    if (!validateConnectorForm()) return;
    createConnectorMutation.mutate({
      organization_id: organizationId!,
      connector_definition_id: connectorForm.connector_definition_id,
      name: connectorForm.name,
      config: JSON.parse(connectorForm.config),
    });
  };

  // Pipeline handlers
  const validatePipelineForm = () => {
    const errors: Record<string, string> = {};
    if (!pipelineForm.name.trim()) errors.name = 'Name is required';
    if (!pipelineForm.source_instance_id) errors.source_instance_id = 'Select a source connector';
    setPipelineErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreatePipeline = () => {
    if (!validatePipelineForm()) return;
    createPipelineMutation.mutate({
      organization_id: organizationId!,
      name: pipelineForm.name,
      source_instance_id: pipelineForm.source_instance_id,
      target_instance_id: pipelineForm.target_instance_id || undefined,
      dataset_id: pipelineForm.dataset_id || undefined,
    });
  };

  // Run handlers
  const handleStartRun = async () => {
    if (!pipelines || pipelines.length === 0) {
      setRunError('No pipelines available');
      return;
    }

    const pipelineId = selectedPipelineId || pipelines[0].pipeline_id;
    setRunStatus('running');
    setRunError('');

    try {
      const params: any = { pipeline_id: pipelineId };
      if (runType === 'test') {
        params.parameters = { limit: 10 };
      }

      const response = await apiFetch(`/organizations/${organizationId}/bridge/runs`, {
        method: 'POST',
        body: JSON.stringify(params),
      });

      // Poll for completion
      const runId = response.run_id;
      let attempts = 0;
      const maxAttempts = 60;

      const pollRun = async () => {
        const runDetails = await apiFetch(`/organizations/${organizationId}/bridge/runs/${runId}`);
        
        if (runDetails.status === 'success') {
          setRunStatus('success');
          refetchRuns();
          return;
        } else if (runDetails.status === 'failed') {
          setRunStatus('error');
          setRunError(runDetails.error_message || 'Run failed');
          return;
        } else if (attempts < maxAttempts) {
          attempts++;
          setTimeout(pollRun, 2000);
        } else {
          setRunStatus('error');
          setRunError('Run timed out');
        }
      };

      setTimeout(pollRun, 2000);
    } catch (error: any) {
      setRunStatus('error');
      setRunError(error?.message || 'Failed to start run');
    }
  };

  if (isLoading || !hasInitialized) {
    return (
      <div className="flex items-center justify-center h-screen">
        <MadronaLoader variant="dots" />
      </div>
    );
  }

  // Completion view
  if (currentStepIndex === wizardSteps.length - 1) {
    return (
      <div className="max-w-6xl mx-auto p-8 space-y-6">
        {/* Completion Banner */}
        <div className="bg-semantic-success/10 border border-semantic-success/20 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-semantic-success flex-shrink-0" />
            <p className="text-sm font-medium text-semantic-success">
              Configuration complete · You can modify pipelines, connectors, and datasets at any time
            </p>
          </div>
        </div>

        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-semantic-success/10 rounded-full mb-4">
            <CheckCircle2 className="h-8 w-8 text-semantic-success" />
          </div>
          <h1 className="text-2xl font-semibold text-ink">Your Madrona instance is ready</h1>
          <p className="mt-2 text-archive max-w-lg mx-auto">
            Your pipelines are configured and producing canonical datasets.
            Review your configuration below, or explore your data.
          </p>
        </div>

        <div className="bg-parchment rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-ink mb-2">Your Configuration</h2>
          <p className="text-sm text-archive mb-4">
            Pipelines extract data from inputs and write canonical entities to datasets.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link
              to={`/organizations/${organizationId}/bridge/setup/pipelines`}
              className="p-4 border border-lichen rounded-md hover:bg-stone transition-colors"
            >
              <RouteIcon className="h-6 w-6 text-forest mb-2" />
              <div className="font-medium text-ink">Review Pipelines</div>
              <div className="text-sm text-archive">{pipelines?.length || 0} configured</div>
            </Link>
            <Link
              to={`/organizations/${organizationId}/bridge/setup/datasets`}
              className="p-4 border border-lichen rounded-md hover:bg-stone transition-colors"
            >
              <FaDatabase className="h-6 w-6 text-forest mb-2" />
              <div className="font-medium text-ink">Review Datasets</div>
              <div className="text-sm text-archive">{datasets?.length || 0} configured</div>
            </Link>
            <Link
              to={`/organizations/${organizationId}/bridge/runs`}
              className="p-4 border border-lichen rounded-md hover:bg-stone transition-colors"
            >
              <Play className="h-6 w-6 text-forest mb-2" />
              <div className="font-medium text-ink">View Run History</div>
              <div className="text-sm text-archive">{runsData?.total_count || 0} runs</div>
            </Link>
          </div>
        </div>

        {/* Contextual Actions */}
        <div className="bg-parchment rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-ink mb-2">Extend Your Configuration</h2>
          <p className="text-sm text-archive mb-4">
            Add more pipelines to produce additional datasets, or configure outputs to publish data.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={() => {
                setCurrentStepIndex(3); // Jump to pipeline step
              }}
              className="p-4 border-2 border-lichen rounded-md hover:border-bark hover:bg-bark/5 transition-colors text-left"
            >
              <RouteIcon className="h-6 w-6 text-forest mb-2" />
              <div className="font-medium text-ink mb-1">Create a pipeline</div>
              <div className="text-sm text-archive">Extract data from a new source into a dataset</div>
            </button>
            <button
              onClick={() => {
                setCurrentStepIndex(2); // Jump to connector step
              }}
              className="p-4 border-2 border-lichen rounded-md hover:border-bark hover:bg-bark/5 transition-colors text-left"
            >
              <Plug className="h-6 w-6 text-forest mb-2" />
              <div className="font-medium text-ink mb-1">Add a connector</div>
              <div className="text-sm text-archive">Connect to another data source or output</div>
            </button>
            <button
              onClick={() => {
                setCurrentStepIndex(1); // Jump to dataset step
              }}
              className="p-4 border-2 border-lichen rounded-md hover:border-bark hover:bg-bark/5 transition-colors text-left"
            >
              <FaDatabase className="h-6 w-6 text-forest mb-2" />
              <div className="font-medium text-ink mb-1">Create a dataset</div>
              <div className="text-sm text-archive">Define a new canonical entity collection</div>
            </button>
          </div>
        </div>

        {/* Primary action */}
        <div className="flex justify-between items-center">
          <p className="text-sm text-archive">
            You can return to this wizard anytime from Configuration → Guided Setup.
          </p>
          <Link
            to={`/organizations/${organizationId}/bridge/setup/pipelines`}
            className="btn-primary text-sm"
          >
            Go to Pipelines
          </Link>
        </div>
      </div>
    );
  }

  // Wizard view
  return (
    <div className="max-w-6xl mx-auto p-8 space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <BookOpen className="w-6 h-6 text-forest" style={{ opacity: 0.6 }} />
          <h1 className="text-2xl font-semibold text-ink">Setup Wizard</h1>
        </div>
        {currentStep.number > 0 && currentStep.number < wizardSteps.length - 1 && (
          <p className="mt-2 text-archive">
            {currentStep.number === 4 ? 'Final step: Run' : `Step ${currentStep.number} of ${wizardSteps.length - 2}: ${currentStep.title}`}
          </p>
        )}
      </div>

      {/* Progress Stepper */}
      <div className="bg-parchment rounded-lg shadow p-6">
        <div className="flex items-center justify-between">
          {wizardSteps.map((step, index) => {
            const Icon = step.icon;
            const isCurrent = index === currentStepIndex;
            const isComplete = step.isComplete;
            const isClickable = index === 0 || index <= wizardSteps.findIndex((s, i) => i > 0 && !s.isComplete);
            const showLine = index < wizardSteps.length - 1;
            
            return (
              <div key={step.id} className="flex items-center flex-1">
                <button
                  onClick={() => handleStepClick(index)}
                  disabled={!isClickable}
                  className={`flex flex-col items-center ${
                    isClickable ? 'cursor-pointer' : isComplete ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 ${
                    isComplete ? 'bg-semantic-success' : isCurrent ? 'bg-bark' : 'bg-stone'
                  }`}>
                    {isComplete ? (
                      <CheckCircle2 className="h-6 w-6 text-parchment" />
                    ) : (
                      <Icon className="h-5 w-5 text-parchment" />
                    )}
                  </div>
                  <span className={`text-xs text-center max-w-[80px] ${
                    isCurrent ? 'text-bark font-medium' : 'text-archive'
                  }`}>
                    {step.title}
                  </span>
                </button>
                {showLine && (
                  <div className={`flex-1 h-0.5 mx-2 ${isComplete ? 'bg-semantic-success' : 'bg-stone'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Step Content */}
      <div className="bg-parchment rounded-lg shadow">
        {/* Welcome Step */}
        {currentStep.id === 'welcome' && (
          <div className="p-6">
            <h2 className="text-2xl font-bold text-ink mb-4">Welcome to Madrona</h2>
            <p className="text-archive mb-6">
              This wizard will guide you through setting up your first data pipeline. You'll configure:
            </p>
            <ul className="space-y-2 mb-6">
              <li className="flex items-start">
                <FaDatabase className="h-5 w-5 text-forest mr-3 mt-0.5" />
                <div>
                  <span className="font-medium">Dataset</span> - Where your data will be organized
                </div>
              </li>
              <li className="flex items-start">
                <Plug className="h-5 w-5 text-forest mr-3 mt-0.5" />
                <div>
                  <span className="font-medium">Connector</span> - Connection to your data source
                </div>
              </li>
              <li className="flex items-start">
                <RouteIcon className="h-5 w-5 text-forest mr-3 mt-0.5" />
                <div>
                  <span className="font-medium">Pipeline</span> - Data flow from source to warehouse
                </div>
              </li>
              <li className="flex items-start">
                <Play className="h-5 w-5 text-forest mr-3 mt-0.5" />
                <div>
                  <span className="font-medium">Run</span> - Execute your first pipeline run
                </div>
              </li>
            </ul>
            <div className="bg-semantic-info/10 border border-semantic-info/20 rounded-md p-4">
              <p className="text-sm text-semantic-info">
                <strong>Estimated time:</strong> ~10 minutes
              </p>
            </div>
          </div>
        )}

        {/* Dataset Step */}
        {currentStep.id === 'dataset' && (
          <div className="p-6">
            <h2 className="text-2xl font-bold text-ink mb-4">Create or Select Dataset</h2>
            
            {datasets && datasets.length > 0 ? (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-ink mb-2">Existing Datasets</h3>
                <div className="space-y-2">
                  {datasets.map((dataset) => (
                    <div
                      key={dataset.dataset_id}
                      className="flex items-center justify-between p-3 border border-lichen rounded-md"
                    >
                      <div>
                        <div className="font-medium text-ink">{dataset.name}</div>
                        <div className="text-sm text-archive">
                          Key: {dataset.key} • Type: {dataset.source_type || 'N/A'}
                        </div>
                      </div>
                      <CheckCircle2 className="h-5 w-5 text-semantic-success" />
                    </div>
                  ))}
                </div>
                <p className="text-sm text-archive mt-4">You have datasets configured. Continue to the next step.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-archive">
                  A dataset represents a logical collection of related entities (e.g., Museum Collection, Donors).
                </p>
                
                <div>
                  <label htmlFor="dataset-name" className="block text-sm font-medium text-ink mb-1">
                    Name <span className="text-semantic-error">*</span>
                  </label>
                  <input
                    id="dataset-name"
                    type="text"
                    value={datasetForm.name}
                    onChange={(e) => setDatasetForm({ ...datasetForm, name: e.target.value })}
                    className={`w-full border rounded-md px-3 py-2 ${
                      datasetErrors.name ? 'border-semantic-error/30' : 'border-lichen'
                    }`}
                    placeholder="Museum Collection"
                    aria-label="Dataset name"
                  />
                  {datasetErrors.name && (
                    <p className="text-sm text-semantic-error mt-1">{datasetErrors.name}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="dataset-key" className="block text-sm font-medium text-ink mb-1">
                    Key <span className="text-semantic-error">*</span>
                  </label>
                  <input
                    id="dataset-key"
                    type="text"
                    value={datasetForm.key}
                    onChange={(e) => setDatasetForm({ ...datasetForm, key: e.target.value })}
                    className={`w-full border rounded-md px-3 py-2 ${
                      datasetErrors.key ? 'border-semantic-error/30' : 'border-lichen'
                    }`}
                    placeholder="collection"
                    aria-label="Dataset key"
                  />
                  <p className="text-xs text-archive mt-1">Lowercase, alphanumeric, hyphens, underscores only</p>
                  {datasetErrors.key && (
                    <p className="text-sm text-semantic-error mt-1">{datasetErrors.key}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="dataset-source-type" className="block text-sm font-medium text-ink mb-1">
                    Source Type <span className="text-semantic-error">*</span>
                  </label>
                  <input
                    id="dataset-source-type"
                    type="text"
                    value={datasetForm.source_type}
                    onChange={(e) => setDatasetForm({ ...datasetForm, source_type: e.target.value })}
                    className={`w-full border rounded-md px-3 py-2 ${
                      datasetErrors.source_type ? 'border-semantic-error/30' : 'border-lichen'
                    }`}
                    placeholder="smithsonian"
                    aria-label="Dataset source type"
                  />
                  {datasetErrors.source_type && (
                    <p className="text-sm text-semantic-error mt-1">{datasetErrors.source_type}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="dataset-description" className="block text-sm font-medium text-ink mb-1">Description</label>
                  <textarea
                    id="dataset-description"
                    value={datasetForm.description}
                    onChange={(e) => setDatasetForm({ ...datasetForm, description: e.target.value })}
                    className="w-full border border-lichen rounded-md px-3 py-2"
                    placeholder="Collection records from Smithsonian"
                    rows={3}
                    aria-label="Dataset description"
                  />
                </div>

                {datasetErrors.submit && (
                  <div className="bg-semantic-error/10 border border-semantic-error/20 rounded-md p-3">
                    <p className="text-sm text-semantic-error">{datasetErrors.submit}</p>
                  </div>
                )}

                <button
                  onClick={handleCreateDataset}
                  disabled={createDatasetMutation.isPending}
                  className="btn-primary w-full"
                >
                  {createDatasetMutation.isPending ? 'Creating...' : 'Create Dataset'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Connector Step */}
        {currentStep.id === 'connector' && (
          <div className="p-6">
            <h2 className="text-2xl font-bold text-ink mb-4">Configure Connector</h2>
            
            {connectorInstances && connectorInstances.length > 0 ? (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-ink mb-2">Existing Connectors</h3>
                <div className="space-y-2">
                  {connectorInstances.map((instance) => (
                    <div
                      key={instance.connector_instance_id}
                      className="flex items-center justify-between p-3 border border-lichen rounded-md"
                    >
                      <div>
                        <div className="font-medium text-ink">{instance.name}</div>
                        <div className="text-sm text-archive">Status: {instance.status}</div>
                      </div>
                      <CheckCircle2 className="h-5 w-5 text-semantic-success" />
                    </div>
                  ))}
                </div>
                <p className="text-sm text-archive mt-4">You have connectors configured. Continue to the next step.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-archive">
                  Connectors enable Madrona to pull data from external systems. Configure a source connector to get started.
                </p>
                
                <div>
                  <label className="block text-sm font-medium text-ink mb-2">
                    Connector Type <span className="text-semantic-error">*</span>
                  </label>
                  <div className={`space-y-4 ${
                    connectorErrors.connector_definition_id ? 'ring-2 ring-semantic-error ring-offset-2 rounded-lg p-2' : ''
                  }`}>
                    {Object.entries(groupedDefinitions).map(([category, defs]) => (
                      <div key={category}>
                        <h4 className="text-sm font-medium text-archive mb-2">
                          {categoryLabels[category] || category.charAt(0).toUpperCase() + category.slice(1)}
                        </h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          {defs.map((def) => (
                            <button
                              key={def.connector_definition_id}
                              type="button"
                              onClick={() => setConnectorForm({ ...connectorForm, connector_definition_id: def.connector_definition_id })}
                              className={`flex items-center gap-3 p-3 border rounded-lg text-left transition-all ${
                                connectorForm.connector_definition_id === def.connector_definition_id
                                  ? 'border-bark bg-bark/5 ring-2 ring-bark/20'
                                  : 'border-lichen hover:border-lichen hover:bg-stone'
                              }`}
                            >
                              <ConnectorIcon connectorKey={def.key} category={def.category ?? undefined} size={24} className="flex-shrink-0 text-archive" />
                              <div className="min-w-0">
                                <div className="font-medium text-ink truncate">{def.display_name}</div>
                                <div className="text-xs text-archive">{def.direction}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  {connectorErrors.connector_definition_id && (
                    <p className="text-sm text-semantic-error mt-2">{connectorErrors.connector_definition_id}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="connector-name" className="block text-sm font-medium text-ink mb-1">
                    Name <span className="text-semantic-error">*</span>
                  </label>
                  <input
                    id="connector-name"
                    type="text"
                    value={connectorForm.name}
                    onChange={(e) => setConnectorForm({ ...connectorForm, name: e.target.value })}
                    className={`w-full border rounded-md px-3 py-2 ${
                      connectorErrors.name ? 'border-semantic-error/30' : 'border-lichen'
                    }`}
                    placeholder="Smithsonian API"
                    aria-label="Connector name"
                  />
                  {connectorErrors.name && (
                    <p className="text-sm text-semantic-error mt-1">{connectorErrors.name}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="connector-config" className="block text-sm font-medium text-ink mb-1">
                    Configuration (JSON) <span className="text-semantic-error">*</span>
                  </label>
                  <textarea
                    id="connector-config"
                    value={connectorForm.config}
                    onChange={(e) => setConnectorForm({ ...connectorForm, config: e.target.value })}
                    className={`w-full border rounded-md px-3 py-2 font-mono text-sm ${
                      connectorErrors.config ? 'border-semantic-error/30' : 'border-lichen'
                    }`}
                    placeholder='{"api_key": "your-key-here"}'
                    rows={4}
                    aria-label="Connector configuration JSON"
                  />
                  <p className="text-xs text-archive mt-1">JSON configuration for this connector</p>
                  {connectorErrors.config && (
                    <p className="text-sm text-semantic-error mt-1">{connectorErrors.config}</p>
                  )}
                </div>

                {connectorErrors.submit && (
                  <div className="bg-semantic-error/10 border border-semantic-error/20 rounded-md p-3">
                    <p className="text-sm text-semantic-error">{connectorErrors.submit}</p>
                  </div>
                )}

                <button
                  onClick={handleCreateConnector}
                  disabled={createConnectorMutation.isPending}
                  className="btn-primary w-full"
                >
                  {createConnectorMutation.isPending ? 'Creating...' : 'Create Connector'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Pipeline Step */}
        {currentStep.id === 'route' && (
          <div className="p-6">
            <h2 className="text-2xl font-bold text-ink mb-4">Define Pipeline</h2>

            {pipelines && pipelines.length > 0 ? (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-ink mb-2">Existing Pipelines</h3>
                <div className="space-y-2">
                  {pipelines.map((pipeline) => {
                    const sourceId = pipeline.sources?.[0]?.connector_instance_id || '';
                    return (
                      <div
                        key={pipeline.pipeline_id}
                        className="flex items-center justify-between p-3 border border-lichen rounded-md"
                      >
                        <div>
                          <div className="font-medium text-ink">{pipeline.name || 'Unnamed Pipeline'}</div>
                          <div className="text-sm text-archive">
                            Source: {sourceId.substring(0, 8)}...
                          </div>
                        </div>
                        <CheckCircle2 className="h-5 w-5 text-semantic-success" />
                      </div>
                    );
                  })}
                </div>
                <p className="text-sm text-archive mt-4">You have pipelines configured. Continue to the next step.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-archive">
                  A pipeline defines how data flows from your source connector into Madrona.
                </p>

                <div>
                  <label htmlFor="pipeline-name" className="block text-sm font-medium text-ink mb-1">
                    Pipeline Name <span className="text-semantic-error">*</span>
                  </label>
                  <input
                    id="pipeline-name"
                    type="text"
                    value={pipelineForm.name}
                    onChange={(e) => setPipelineForm({ ...pipelineForm, name: e.target.value })}
                    className={`w-full border rounded-md px-3 py-2 ${
                      pipelineErrors.name ? 'border-semantic-error/30' : 'border-lichen'
                    }`}
                    placeholder="Smithsonian → Madrona"
                    aria-label="Pipeline name"
                  />
                  {pipelineErrors.name && (
                    <p className="text-sm text-semantic-error mt-1">{pipelineErrors.name}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="pipeline-source-connector" className="block text-sm font-medium text-ink mb-1">
                    Source Connector <span className="text-semantic-error">*</span>
                  </label>
                  <select
                    id="pipeline-source-connector"
                    value={pipelineForm.source_instance_id}
                    onChange={(e) => setPipelineForm({ ...pipelineForm, source_instance_id: e.target.value })}
                    className={`w-full border rounded-md px-3 py-2 ${
                      pipelineErrors.source_instance_id ? 'border-semantic-error/30' : 'border-lichen'
                    }`}
                  >
                    <option value="">Select source connector</option>
                    {connectorInstances?.map((instance) => (
                      <option key={instance.connector_instance_id} value={instance.connector_instance_id}>
                        {instance.name}
                      </option>
                    ))}
                  </select>
                  {pipelineErrors.source_instance_id && (
                    <p className="text-sm text-semantic-error mt-1">{pipelineErrors.source_instance_id}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="pipeline-dataset" className="block text-sm font-medium text-ink mb-1">
                    Dataset (Optional)
                  </label>
                  <select
                    id="pipeline-dataset"
                    value={pipelineForm.dataset_id}
                    onChange={(e) => setPipelineForm({ ...pipelineForm, dataset_id: e.target.value })}
                    className="w-full border border-lichen rounded-md px-3 py-2"
                  >
                    <option value="">Auto-match by source type</option>
                    {datasets?.map((dataset) => (
                      <option key={dataset.dataset_id} value={dataset.dataset_id}>
                        {dataset.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-archive mt-1">Leave empty to auto-match by source type</p>
                </div>

                <div>
                  <label htmlFor="pipeline-target-connector" className="block text-sm font-medium text-ink mb-1">
                    Target Connector (Optional)
                  </label>
                  <select
                    id="pipeline-target-connector"
                    value={pipelineForm.target_instance_id}
                    onChange={(e) => setPipelineForm({ ...pipelineForm, target_instance_id: e.target.value })}
                    className="w-full border border-lichen rounded-md px-3 py-2"
                  >
                    <option value="">Madrona (source-only)</option>
                    {connectorInstances?.map((instance) => (
                      <option key={instance.connector_instance_id} value={instance.connector_instance_id}>
                        {instance.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-archive mt-1">Leave empty for data warehouse ingestion only</p>
                </div>

                {pipelineErrors.submit && (
                  <div className="bg-semantic-error/10 border border-semantic-error/20 rounded-md p-3">
                    <p className="text-sm text-semantic-error">{pipelineErrors.submit}</p>
                  </div>
                )}

                <button
                  onClick={handleCreatePipeline}
                  disabled={createPipelineMutation.isPending}
                  className="btn-primary w-full"
                >
                  {createPipelineMutation.isPending ? 'Creating...' : 'Create Pipeline'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Run Step */}
        {currentStep.id === 'run' && (
          <div className="p-6">
            <h2 className="text-2xl font-bold text-ink mb-4">Run Your Pipeline</h2>

            {runStatus === 'success' ? (
              <div className="mb-6">
                <div className="bg-semantic-success/10 border border-semantic-success/30 rounded-md p-4 mb-4">
                  <div className="flex items-center">
                    <CheckCircle2 className="h-5 w-5 text-semantic-success mr-2" />
                    <p className="text-sm text-semantic-success font-medium">Pipeline run completed successfully!</p>
                  </div>
                  <p className="text-sm text-semantic-success mt-2">
                    Your pipeline has written canonical entities to the dataset. You can run pipelines again at any time.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-archive">
                  Execute your pipeline to extract data from the source and write canonical entities to the dataset.
                </p>

                <div>
                  <label htmlFor="run-pipeline-select" className="block text-sm font-medium text-ink mb-2">Select Pipeline</label>
                  <select
                    id="run-pipeline-select"
                    value={selectedPipelineId}
                    onChange={(e) => setSelectedPipelineId(e.target.value)}
                    className="w-full border border-lichen rounded-md px-3 py-2"
                    disabled={runStatus === 'running'}
                  >
                    <option value="">Use first available pipeline</option>
                    {pipelines?.map((pipeline) => (
                        <option key={pipeline.pipeline_id} value={pipeline.pipeline_id}>
                          {pipeline.name || `Pipeline ${pipeline.pipeline_id.substring(0, 8)}`}
                        </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-ink mb-2">Run Type</label>
                  <div className="space-y-2">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        value="test"
                        checked={runType === 'test'}
                        onChange={(e) => setRunType(e.target.value as 'test' | 'full')}
                        className="mr-2"
                        disabled={runStatus === 'running'}
                        aria-label="Test Run (10 records)"
                      />
                      <span>Test Run (10 records)</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        value="full"
                        checked={runType === 'full'}
                        onChange={(e) => setRunType(e.target.value as 'test' | 'full')}
                        className="mr-2"
                        disabled={runStatus === 'running'}
                        aria-label="Full Run (all records)"
                      />
                      <span>Full Run (all records)</span>
                    </label>
                  </div>
                  <p className="text-sm text-archive mt-2">Test mode limits the record count. Full mode extracts all available data into the dataset.</p>
                </div>

                {runStatus === 'running' && (
                  <div className="bg-semantic-info/10 border border-semantic-info/20 rounded-md p-4">
                    <div className="flex items-start">
                      <div className="mr-3 mt-0.5"><MadronaLoader variant="dots" /></div>
                      <div>
                        <p className="text-sm text-semantic-info font-medium">Run in progress</p>
                        <p className="text-sm text-semantic-info mt-1">This may take a few moments.</p>
                      </div>
                    </div>
                  </div>
                )}

                {runStatus === 'error' && (
                  <div className="bg-semantic-error/10 border border-semantic-error/20 rounded-md p-4">
                    <div className="flex items-center">
                      <AlertCircle className="h-5 w-5 text-semantic-error mr-2" />
                      <p className="text-sm text-semantic-error font-medium">Run failed</p>
                    </div>
                    <p className="text-sm text-semantic-error mt-2">{runError}</p>
                  </div>
                )}

                <button
                  onClick={handleStartRun}
                  disabled={runStatus === 'running' || !pipelines || pipelines.length === 0}
                  className="btn-primary w-full"
                >
                  {runStatus === 'running' ? 'Running...' : 'Start Run'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={handlePrevious}
          disabled={!canMoveBackward()}
          className="inline-flex items-center px-4 py-2 text-ink bg-parchment border border-lichen rounded-md hover:bg-stone disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Previous
        </button>
        <div className="flex flex-col items-end">
          <button
            onClick={handleNext}
            disabled={!canMoveForward()}
            className="btn-primary text-sm"
          >
            Continue
            <ArrowRight className="ml-2 h-4 w-4" />
          </button>
          {!currentStep.isComplete && currentStep.number > 0 && currentStep.number < wizardSteps.length - 1 && (
            <p className="text-sm text-archive mt-2">Complete the {currentStep.id === 'run' ? 'pipeline run' : 'current step'} before continuing.</p>
          )}
        </div>
      </div>
    </div>
  );
}
