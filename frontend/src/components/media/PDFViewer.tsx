import { useState, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ChevronLeft, ChevronRight, ExternalLink, Loader2 } from 'lucide-react';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure worker — use unpkg CDN to avoid pnpm hoisting issues with pdfjs-dist
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFViewerProps {
  url: string;
  /** Fallback download URL if rendering fails */
  downloadUrl?: string;
}

export default function PDFViewer({ url, downloadUrl }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState(false);

  const onDocumentLoadSuccess = useCallback(({ numPages: total }: { numPages: number }) => {
    setNumPages(total);
    setCurrentPage(1);
    setError(false);
  }, []);

  const onDocumentLoadError = useCallback(() => {
    setError(true);
  }, []);

  const goToPrev = useCallback(() => {
    setCurrentPage((p) => Math.max(1, p - 1));
  }, []);

  const goToNext = useCallback(() => {
    setCurrentPage((p) => Math.min(numPages || 1, p + 1));
  }, [numPages]);

  if (error) {
    return (
      <div className="text-center p-12">
        <p className="text-archive mb-4">Unable to render PDF preview</p>
        <a
          href={downloadUrl || url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/30 transition-colors text-ink"
        >
          <ExternalLink size={16} />
          Open File
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center w-full">
      {/* PDF page */}
      <div className="w-full flex justify-center overflow-auto bg-stone/20 min-h-[300px]">
        <Document
          file={url}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={
            <div className="flex items-center justify-center min-h-[300px]">
              <Loader2 size={24} className="animate-spin text-archive" />
            </div>
          }
        >
          <Page
            pageNumber={currentPage}
            width={Math.min(800, window.innerWidth - 80)}
            loading={
              <div className="flex items-center justify-center min-h-[300px]">
                <Loader2 size={24} className="animate-spin text-archive" />
              </div>
            }
          />
        </Document>
      </div>

      {/* Page navigation */}
      {numPages !== null && numPages > 0 && (
        <div className="flex items-center gap-3 py-2 px-4 bg-stone/30 border-t border-lichen w-full justify-center">
          <button
            onClick={goToPrev}
            disabled={currentPage <= 1}
            className="p-1.5 rounded hover:bg-stone disabled:opacity-30 transition-colors"
            aria-label="Previous page"
          >
            <ChevronLeft size={18} className="text-ink" />
          </button>
          <span className="text-sm text-ink font-medium tabular-nums">
            Page {currentPage} of {numPages}
          </span>
          <button
            onClick={goToNext}
            disabled={currentPage >= numPages}
            className="p-1.5 rounded hover:bg-stone disabled:opacity-30 transition-colors"
            aria-label="Next page"
          >
            <ChevronRight size={18} className="text-ink" />
          </button>
        </div>
      )}
    </div>
  );
}
