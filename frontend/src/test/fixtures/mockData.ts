import type { Pipeline, ConnectorInstance, Dataset, ConnectorDefinition, Run } from '../../lib/schemas';

// Mock Connector Definitions
export const mockSourceConnectorDefinition: ConnectorDefinition = {
  connector_definition_id: 'def-source-1',
  key: 'smithsonian',
  display_name: 'Smithsonian API',
  direction: 'source',
  config_schema: {},
  created_at: '2024-01-01T00:00:00Z',
};

export const mockDestinationConnectorDefinition: ConnectorDefinition = {
  connector_definition_id: 'def-dest-1',
  key: 'db-postgres',
  display_name: 'PostgreSQL',
  direction: 'target',
  config_schema: {},
  created_at: '2024-01-01T00:00:00Z',
};

// Mock Connector Instances
export const mockSourceConnector: ConnectorInstance & { connector_definition?: ConnectorDefinition } = {
  connector_instance_id: 'source-1',
  organization_id: 'org-1',
  connector_definition_id: 'def-source-1',
  name: 'Smithsonian Source',
  status: 'active',
  config: {},
  connector_definition: mockSourceConnectorDefinition,
  created_at: '2024-01-01T00:00:00Z',
};

export const mockDestinationConnector: ConnectorInstance & { connector_definition?: ConnectorDefinition } = {
  connector_instance_id: 'dest-1',
  organization_id: 'org-1',
  connector_definition_id: 'def-dest-1',
  name: 'Google Sheets Export',
  status: 'active',
  config: {},
  connector_definition: mockDestinationConnectorDefinition,
  created_at: '2024-01-01T00:00:00Z',
};

export const mockSourceConnector2: ConnectorInstance & { connector_definition?: ConnectorDefinition } = {
  connector_instance_id: 'source-2',
  organization_id: 'org-1',
  connector_definition_id: 'def-source-1',
  name: 'Smithsonian Source 2',
  status: 'active',
  config: {},
  connector_definition: mockSourceConnectorDefinition,
  created_at: '2024-01-01T00:00:00Z',
};

export const mockDestinationConnector2: ConnectorInstance & { connector_definition?: ConnectorDefinition } = {
  connector_instance_id: 'dest-2',
  organization_id: 'org-1',
  connector_definition_id: 'def-dest-1',
  name: 'Google Sheets Export 2',
  status: 'active',
  config: {},
  connector_definition: mockDestinationConnectorDefinition,
  created_at: '2024-01-01T00:00:00Z',
};

// Mock Datasets
export const mockDataset: Dataset = {
  dataset_id: 'dataset-1',
  organization_id: 'org-1',
  name: 'Museum Objects',
  key: 'objects',
  description: 'Collection objects from museums',
  source_type: null,
  schema: null,
  role: 'canonical',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-10T15:30:00Z',
  entity_count: 1247,
};

export const mockDataset2: Dataset = {
  dataset_id: 'dataset-2',
  organization_id: 'org-1',
  name: 'Exhibitions',
  key: 'exhibitions',
  description: 'Museum exhibitions',
  source_type: null,
  schema: null,
  role: 'canonical',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-05T09:15:00Z',
  entity_count: 89,
};

// Mock Pipelines

// Pipeline with 1 source, 0 destinations
export const mockPipelineSourceOnly: Pipeline = {
  pipeline_id: 'pipeline-1',
  organization_id: 'org-1',
  name: 'Smithsonian to Objects',
  dataset_id: 'dataset-1',
  status: 'active',
  created_at: '2024-01-01T00:00:00Z',
  sources: [
    {
      source_id: 'src-1',
      connector_instance_id: 'source-1',
      enabled: true,
      parameters: {},
      ordering: 0,
    },
  ],
  destinations: [],
};

// Pipeline with 1 source, 1 destination
export const mockPipelineSourceAndDest: Pipeline = {
  pipeline_id: 'pipeline-2',
  organization_id: 'org-1',
  name: 'Smithsonian to Sheets',
  dataset_id: 'dataset-1',
  status: 'active',
  created_at: '2024-01-01T00:00:00Z',
  sources: [
    {
      source_id: 'src-2',
      connector_instance_id: 'source-1',
      enabled: true,
      parameters: {},
      ordering: 0,
    },
  ],
  destinations: [
    {
      destination_id: 'dst-1',
      connector_instance_id: 'dest-1',
      enabled: true,
      parameters: {},
      ordering: 0,
    },
  ],
};

// Mock pipeline with 2 sources, 2 destinations (for multi-source/dest scenarios)
export const mockPipelineMultiSourceDest: Pipeline = {
  pipeline_id: 'pipeline-3',
  organization_id: 'org-1',
  name: 'Multi-Source Pipeline',
  dataset_id: 'dataset-1',
  status: 'active',
  created_at: '2024-01-01T00:00:00Z',
  sources: [
    {
      source_id: 'src-3',
      connector_instance_id: 'source-1',
      enabled: true,
      parameters: {},
      ordering: 0,
    },
    {
      source_id: 'src-4',
      connector_instance_id: 'source-2',
      enabled: true,
      parameters: {},
      ordering: 1,
    },
  ],
  destinations: [
    {
      destination_id: 'dst-2',
      connector_instance_id: 'dest-1',
      enabled: true,
      parameters: {},
      ordering: 0,
    },
    {
      destination_id: 'dst-3',
      connector_instance_id: 'dest-2',
      enabled: false,
      parameters: {},
      ordering: 1,
    },
  ],
};

// Pipeline with delete detection enabled
export const mockPipelineWithDeleteDetection: Pipeline = {
  pipeline_id: 'pipeline-4',
  organization_id: 'org-1',
  name: 'Pipeline with Delete Detection',
  dataset_id: 'dataset-1',
  status: 'active',
  created_at: '2024-01-01T00:00:00Z',
  delete_detection_enabled: true,
  delete_detection_method: 'full_sync',
  sources: [
    {
      source_id: 'src-5',
      connector_instance_id: 'source-1',
      enabled: true,
      parameters: {},
      ordering: 0,
    },
  ],
  destinations: [
    {
      destination_id: 'dst-4',
      connector_instance_id: 'dest-1',
      enabled: true,
      parameters: {},
      ordering: 0,
      publish_deletes: true,
      delete_strategy: 'remove',
    },
  ],
};

// Mock Runs
export const mockRunSuccess: Run = {
  run_id: 'run-1',
  pipeline_id: 'pipeline-1',
  status: 'success',
  started_at: '2024-01-10T10:00:00Z',
  finished_at: '2024-01-10T10:05:00Z',
  parameters: {},
  counts: {
    processed: 100,
    created: 50,
    updated: 40,
    noop: 10,
    failed: 0,
  },
};

export const mockRunFailed: Run = {
  run_id: 'run-2',
  pipeline_id: 'pipeline-1',
  status: 'failed',
  started_at: '2024-01-09T10:00:00Z',
  finished_at: '2024-01-09T10:02:00Z',
  parameters: {},
  error: 'Connection timeout',
  counts: {
    processed: 10,
    created: 5,
    updated: 5,
    noop: 0,
    failed: 0,
  },
};

export const mockRunRunning: Run = {
  run_id: 'run-3',
  pipeline_id: 'pipeline-2',
  status: 'running',
  started_at: '2024-01-11T10:00:00Z',
  parameters: {},
  counts: {
    processed: 0,
    created: 0,
    updated: 0,
    noop: 0,
    failed: 0,
  },
};

// Run with deleted entities
export const mockRunWithDeletes: Run = {
  run_id: 'run-4',
  pipeline_id: 'pipeline-4',
  status: 'success',
  started_at: '2024-01-12T10:00:00Z',
  finished_at: '2024-01-12T10:05:00Z',
  parameters: {},
  counts: {
    processed: 150,
    created: 30,
    updated: 100,
    noop: 15,
    failed: 0,
    deleted: 5,
  },
};

// Collections for easy access
export const mockConnectors = [
  mockSourceConnector,
  mockDestinationConnector,
  mockSourceConnector2,
  mockDestinationConnector2,
];

export const mockDatasets = [mockDataset, mockDataset2];

export const mockPipelines = [
  mockPipelineSourceOnly,
  mockPipelineSourceAndDest,
  mockPipelineMultiSourceDest,
  mockPipelineWithDeleteDetection,
];

export const mockRuns = [mockRunSuccess, mockRunFailed, mockRunRunning, mockRunWithDeletes];
