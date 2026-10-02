import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock react-pdf to avoid jsdom issues with PDF.js
let __PDF_FAIL = false;
vi.mock('react-pdf', () => ({
  Document: ({
    children,
    onLoadSuccess,
    onLoadError,
    loading,
  }: {
    children?: React.ReactNode;
    onLoadSuccess?: (info: { numPages: number }) => void;
    onLoadError?: () => void;
    loading?: React.ReactNode;
  }) => {
    // Simulate load on next tick — error or success based on flag
    setTimeout(() => {
      if (__PDF_FAIL) {
        onLoadError?.();
      } else {
        onLoadSuccess?.({ numPages: 5 });
      }
    }, 0);
    return (
      <div data-testid="pdf-document">
        <div data-testid="pdf-loading">{loading}</div>
        {children}
      </div>
    );
  },
  Page: ({ pageNumber }: { pageNumber: number }) => <div data-testid={`pdf-page-${pageNumber}`}>Page {pageNumber}</div>,
  pdfjs: { GlobalWorkerOptions: { workerSrc: '' }, version: '4.0.0' },
}));

vi.mock('react-pdf/dist/Page/AnnotationLayer.css', () => ({}));
vi.mock('react-pdf/dist/Page/TextLayer.css', () => ({}));

import PDFViewer from '../../../components/media/PDFViewer';
import { beforeEach } from 'vitest';

describe('PDFViewer', () => {
  beforeEach(() => {
    __PDF_FAIL = false;
  });

  it('renders Document with given URL', () => {
    render(<PDFViewer url="http://x/file.pdf" />);
    expect(screen.getByTestId('pdf-document')).toBeInTheDocument();
  });

  it('renders the first page initially', () => {
    render(<PDFViewer url="http://x/file.pdf" />);
    expect(screen.getByTestId('pdf-page-1')).toBeInTheDocument();
  });

  it('shows page navigation after document loads', async () => {
    render(<PDFViewer url="http://x/file.pdf" />);
    // The mocked Document fires onLoadSuccess on next tick
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByText('Page 1 of 5')).toBeInTheDocument();
  });

  it('disables Previous on page 1', async () => {
    render(<PDFViewer url="http://x/file.pdf" />);
    await new Promise((r) => setTimeout(r, 10));
    const prev = screen.getByLabelText('Previous page');
    expect(prev).toBeDisabled();
  });

  it('navigates to next page when Next clicked', async () => {
    render(<PDFViewer url="http://x/file.pdf" />);
    await new Promise((r) => setTimeout(r, 10));
    fireEvent.click(screen.getByLabelText('Next page'));
    expect(screen.getByText('Page 2 of 5')).toBeInTheDocument();
  });

  it('shows error fallback when load fails', async () => {
    __PDF_FAIL = true;
    render(<PDFViewer url="http://x/file.pdf" />);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByText('Unable to render PDF preview')).toBeInTheDocument();
  });

  it('uses downloadUrl when provided', async () => {
    __PDF_FAIL = true;
    render(<PDFViewer url="http://x/file.pdf" downloadUrl="http://x/download.pdf" />);
    await new Promise((r) => setTimeout(r, 10));
    const link = screen.getByText('Open File').closest('a');
    expect(link).toHaveAttribute('href', 'http://x/download.pdf');
  });

  it('shows Open File link in error state', async () => {
    __PDF_FAIL = true;
    render(<PDFViewer url="http://x/file.pdf" />);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByText('Open File')).toBeInTheDocument();
  });
});
