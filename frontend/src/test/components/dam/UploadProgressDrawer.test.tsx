import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UploadProgressDrawer } from '../../../components/dam/UploadProgressDrawer';

// The drawer pulls from useUpload — mock the context hook entirely
const mockRetry = vi.fn();
const mockRemove = vi.fn();
const mockClearCompleted = vi.fn();
const mockCancelAll = vi.fn();

let mockState = {
  uploads: [] as Array<{
    id: string;
    file: File;
    status: 'queued' | 'uploading' | 'processing' | 'completed' | 'failed';
    progress: number;
    error?: string;
  }>,
  isUploading: false,
  completedCount: 0,
  failedCount: 0,
  retryUpload: mockRetry,
  removeUpload: mockRemove,
  clearCompleted: mockClearCompleted,
  cancelAll: mockCancelAll,
};

vi.mock('../../../contexts/uploadStore', () => ({
  useUpload: () => mockState,
}));

describe('UploadProgressDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState = {
      uploads: [],
      isUploading: false,
      completedCount: 0,
      failedCount: 0,
      retryUpload: mockRetry,
      removeUpload: mockRemove,
      clearCompleted: mockClearCompleted,
      cancelAll: mockCancelAll,
    };
  });

  it('renders nothing when uploads list is empty', () => {
    const { container } = render(<UploadProgressDrawer />);
    expect(container.firstChild).toBeNull();
  });

  it('renders uploading state header', () => {
    mockState = {
      ...mockState,
      isUploading: true,
      uploads: [
        { id: '1', file: new File([''], 'a.jpg', { type: 'image/jpeg' }), status: 'uploading', progress: 50 },
      ],
    };
    render(<UploadProgressDrawer />);
    expect(screen.getByText(/Uploading 1 file\.\.\./)).toBeInTheDocument();
  });

  it('renders completed summary when done', () => {
    mockState = {
      ...mockState,
      completedCount: 3,
      uploads: [
        { id: '1', file: new File([''], 'a.jpg', { type: 'image/jpeg' }), status: 'completed', progress: 100 },
      ],
    };
    render(<UploadProgressDrawer />);
    expect(screen.getByText(/3 files uploaded/)).toBeInTheDocument();
  });

  it('renders failed count when failures exist', () => {
    mockState = {
      ...mockState,
      failedCount: 1,
      completedCount: 1,
      uploads: [
        { id: '1', file: new File([''], 'a.jpg', { type: 'image/jpeg' }), status: 'failed', progress: 0, error: 'err' },
      ],
    };
    render(<UploadProgressDrawer />);
    expect(screen.getByText(/1 failed, 1 completed/)).toBeInTheDocument();
  });

  it('calls clearCompleted when X button clicked (not uploading)', () => {
    mockState = {
      ...mockState,
      completedCount: 1,
      uploads: [
        { id: '1', file: new File([''], 'a.jpg', { type: 'image/jpeg' }), status: 'completed', progress: 100 },
      ],
    };
    render(<UploadProgressDrawer />);
    fireEvent.click(screen.getByLabelText('Clear all uploads'));
    expect(mockClearCompleted).toHaveBeenCalledTimes(1);
  });

  it('calls retryUpload for failed file retry button', () => {
    const file = new File([''], 'a.jpg', { type: 'image/jpeg' });
    mockState = {
      ...mockState,
      failedCount: 1,
      uploads: [{ id: 'x1', file, status: 'failed', progress: 0, error: 'oops' }],
    };
    render(<UploadProgressDrawer />);
    fireEvent.click(screen.getByLabelText('Retry uploading a.jpg'));
    expect(mockRetry).toHaveBeenCalledWith('x1');
  });

  it('calls removeUpload for completed file remove button', () => {
    const file = new File([''], 'done.jpg', { type: 'image/jpeg' });
    mockState = {
      ...mockState,
      completedCount: 1,
      uploads: [{ id: 'x2', file, status: 'completed', progress: 100 }],
    };
    render(<UploadProgressDrawer />);
    fireEvent.click(screen.getByLabelText('Remove done.jpg from list'));
    expect(mockRemove).toHaveBeenCalledWith('x2');
  });

  it('shows Cancel remaining uploads when queued items exist', () => {
    mockState = {
      ...mockState,
      isUploading: true,
      uploads: [
        { id: '1', file: new File([''], 'a.jpg', { type: 'image/jpeg' }), status: 'queued', progress: 0 },
        { id: '2', file: new File([''], 'b.jpg', { type: 'image/jpeg' }), status: 'uploading', progress: 30 },
      ],
    };
    render(<UploadProgressDrawer />);
    const cancelBtn = screen.getByText('Cancel remaining uploads');
    fireEvent.click(cancelBtn);
    expect(mockCancelAll).toHaveBeenCalledTimes(1);
  });

  it('collapses file list when header toggle clicked', () => {
    mockState = {
      ...mockState,
      completedCount: 1,
      uploads: [
        { id: '1', file: new File([''], 'visible.jpg', { type: 'image/jpeg' }), status: 'completed', progress: 100 },
      ],
    };
    render(<UploadProgressDrawer />);

    // Initially expanded — filename visible
    expect(screen.getByText('visible.jpg')).toBeInTheDocument();

    // Click header to collapse
    const header = screen.getByText(/1 file uploaded/);
    fireEvent.click(header);

    expect(screen.queryByText('visible.jpg')).not.toBeInTheDocument();
  });
});
