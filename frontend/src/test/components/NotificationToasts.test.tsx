import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { NotificationToasts } from '../../components/NotificationToasts';
import * as useNotificationsHook from '../../hooks/useNotifications';
import * as useRunUpdatesHook from '../../hooks/useRunUpdates';
import * as ToastContext from '../../contexts/ToastContext';

// Mock the hooks
vi.mock('../../hooks/useNotifications', () => ({
  useNotifications: vi.fn(),
}));

vi.mock('../../hooks/useRunUpdates', () => ({
  useRunUpdates: vi.fn(),
}));

vi.mock('../../contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({
    showToast: vi.fn(),
  })),
}));

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Mock useOrganization
vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: () => ({ activeOrganizationId: 'test-org-123' }),
}));

const mockUseNotifications = vi.mocked(useNotificationsHook.useNotifications);
const mockUseRunUpdates = vi.mocked(useRunUpdatesHook.useRunUpdates);
const mockUseToast = vi.mocked(ToastContext.useToast);

describe('NotificationToasts', () => {
  let mockShowToast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockShowToast = vi.fn();
    mockUseToast.mockReturnValue({ showToast: mockShowToast } as any);
    mockUseNotifications.mockImplementation(() => {});
    mockUseRunUpdates.mockImplementation(() => {});
  });

  describe('rendering', () => {
    it('renders nothing visible', () => {
      const { container } = render(<NotificationToasts />);
      expect(container.firstChild).toBeNull();
    });

    it('subscribes to notifications', () => {
      render(<NotificationToasts />);
      expect(mockUseNotifications).toHaveBeenCalledWith({
        onNotification: expect.any(Function),
      });
    });

    it('subscribes to run updates', () => {
      render(<NotificationToasts />);
      expect(mockUseRunUpdates).toHaveBeenCalledWith({
        onRunCompleted: expect.any(Function),
        onRunFailed: expect.any(Function),
      });
    });
  });

  describe('run completed notifications', () => {
    it('shows success toast on run completion', () => {
      let runUpdateHandler: any;
      mockUseRunUpdates.mockImplementation(({ onRunCompleted }) => {
        runUpdateHandler = onRunCompleted;
      });

      render(<NotificationToasts />);

      // Simulate run completion
      runUpdateHandler({
        runId: 'run-123',
        pipelineId: 'pipe-456',
        status: 'completed',
      });

      expect(mockShowToast).toHaveBeenCalledWith({
        type: 'success',
        title: 'Run Completed',
        message: 'Pipeline run finished successfully.',
        action: expect.objectContaining({
          label: 'View Run',
        }),
      });
    });

    it('navigates to run on action click for completed run', () => {
      let runUpdateHandler: any;
      mockUseRunUpdates.mockImplementation(({ onRunCompleted }) => {
        runUpdateHandler = onRunCompleted;
      });

      render(<NotificationToasts />);

      runUpdateHandler({
        runId: 'run-123',
        pipelineId: 'pipe-456',
        status: 'completed',
      });

      // Get the action from the toast call and execute it
      const toastCall = mockShowToast.mock.calls[0][0];
      toastCall.action.onClick();

      expect(mockNavigate).toHaveBeenCalledWith('/organizations/test-org-123/bridge/runs/run-123');
    });
  });

  describe('run failed notifications', () => {
    it('shows error toast on run failure', () => {
      let runUpdateHandler: any;
      mockUseRunUpdates.mockImplementation(({ onRunFailed }) => {
        runUpdateHandler = onRunFailed;
      });

      render(<NotificationToasts />);

      runUpdateHandler({
        runId: 'run-123',
        pipelineId: 'pipe-456',
        status: 'failed',
        error: 'Connection timeout',
      });

      expect(mockShowToast).toHaveBeenCalledWith({
        type: 'error',
        title: 'Run Failed',
        message: 'Connection timeout',
        action: expect.objectContaining({
          label: 'View Details',
        }),
      });
    });

    it('shows default error message when no error provided', () => {
      let runUpdateHandler: any;
      mockUseRunUpdates.mockImplementation(({ onRunFailed }) => {
        runUpdateHandler = onRunFailed;
      });

      render(<NotificationToasts />);

      runUpdateHandler({
        runId: 'run-123',
        pipelineId: 'pipe-456',
        status: 'failed',
      });

      expect(mockShowToast).toHaveBeenCalledWith({
        type: 'error',
        title: 'Run Failed',
        message: 'Pipeline run encountered an error.',
        action: expect.objectContaining({
          label: 'View Details',
        }),
      });
    });
  });

  describe('general notifications', () => {
    it('shows toast for general notification', () => {
      let notificationHandler: any;
      mockUseNotifications.mockImplementation(({ onNotification }) => {
        notificationHandler = onNotification;
      });

      render(<NotificationToasts />);

      notificationHandler({
        type: 'info',
        title: 'Update Available',
        message: 'A new version is available',
        data: {},
      });

      expect(mockShowToast).toHaveBeenCalledWith({
        type: 'info',
        title: 'Update Available',
        message: 'A new version is available',
        action: undefined,
      });
    });

    it('adds view action for notification with run_id', () => {
      let notificationHandler: any;
      mockUseNotifications.mockImplementation(({ onNotification }) => {
        notificationHandler = onNotification;
      });

      render(<NotificationToasts />);

      notificationHandler({
        type: 'success',
        title: 'Run Complete',
        message: 'Your pipeline finished',
        data: { run_id: 'run-789' },
      });

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          action: expect.objectContaining({
            label: 'View',
          }),
        })
      );

      // Test action navigation
      const toastCall = mockShowToast.mock.calls[0][0];
      toastCall.action.onClick();
      expect(mockNavigate).toHaveBeenCalledWith('/organizations/test-org-123/bridge/runs/run-789');
    });

    it('adds view action for notification with pipeline_id', () => {
      let notificationHandler: any;
      mockUseNotifications.mockImplementation(({ onNotification }) => {
        notificationHandler = onNotification;
      });

      render(<NotificationToasts />);

      notificationHandler({
        type: 'warning',
        title: 'Pipeline Warning',
        message: 'Check your configuration',
        data: { pipeline_id: 'pipe-123' },
      });

      // Test action navigation
      const toastCall = mockShowToast.mock.calls[0][0];
      toastCall.action.onClick();
      expect(mockNavigate).toHaveBeenCalledWith('/organizations/test-org-123/bridge/setup/pipelines/pipe-123');
    });
  });

  describe('ignoring non-terminal states', () => {
    it('does not show toast for running status', () => {
      let runUpdateHandler: any;
      mockUseRunUpdates.mockImplementation(({ onRunCompleted }) => {
        runUpdateHandler = onRunCompleted;
      });

      render(<NotificationToasts />);

      runUpdateHandler({
        runId: 'run-123',
        pipelineId: 'pipe-456',
        status: 'running',
      });

      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it('does not show toast for pending status', () => {
      let runUpdateHandler: any;
      mockUseRunUpdates.mockImplementation(({ onRunCompleted }) => {
        runUpdateHandler = onRunCompleted;
      });

      render(<NotificationToasts />);

      runUpdateHandler({
        runId: 'run-123',
        pipelineId: 'pipe-456',
        status: 'pending',
      });

      expect(mockShowToast).not.toHaveBeenCalled();
    });
  });
});
