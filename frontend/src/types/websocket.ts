/**
 * WebSocket event types emitted by the server
 */
export interface RunStartedEvent {
  event: 'run:started';
  run_id: string;
  pipeline_id: string;
  status: 'running';
}

export interface RunProgressEvent {
  event: 'run:progress';
  run_id: string;
  pipeline_id: string;
  status: string;
  counts: {
    processed: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    deleted: number;
  };
}

export interface RunCompletedEvent {
  event: 'run:completed';
  run_id: string;
  pipeline_id: string;
  status: string;
  duration_ms: number;
  counts: {
    processed: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    deleted: number;
  };
}

export interface RunFailedEvent {
  event: 'run:failed';
  run_id: string;
  pipeline_id: string;
  status: 'failed';
  error: string;
  error_stage: string | null;
}

export interface JobStatusEvent {
  event: 'job:status';
  job_id: string;
  pipeline_id: string;
  status: string;
}

export interface NotificationEvent {
  event: 'notification';
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  data: Record<string, unknown>;
}

export type WebSocketEvent =
  | RunStartedEvent
  | RunProgressEvent
  | RunCompletedEvent
  | RunFailedEvent
  | JobStatusEvent
  | NotificationEvent;

/**
 * Event handler type for WebSocket events
 */
export type EventHandler<T> = (data: T) => void;
