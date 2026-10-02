import { useState, useEffect } from 'react';
import { X, RefreshCw, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { previewConnectorData } from '../lib/api';
import type { PreviewResult } from '../lib/api';
import { useAccessibleModal, getModalAriaProps } from '../hooks/useAccessibleModal';
import { formatNumber } from '../lib/formatters';
import { ModalPortal } from './ModalPortal';

interface DataPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  instanceId: string;
  objectId: string;
  objectName: string;
}

export default function DataPreviewModal({
  isOpen,
  onClose,
  instanceId,
  objectId,
  objectName,
}: DataPreviewModalProps) {
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'data-preview-modal',
  });
  const [data, setData] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize] = useState(25);

  useEffect(() => {
    if (isOpen && objectId) {
      loadData();
    }
  }, [isOpen, objectId, page]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await previewConnectorData(instanceId, {
        object_id: objectId,
        limit: pageSize,
        offset: page * pageSize,
      });
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load preview');
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = () => {
    if (!data || data.rows.length === 0) return;

    const headers = data.columns.join(',');
    const rows = data.rows.map((row) =>
      data.columns
        .map((col) => {
          const val = row[col];
          if (val === null || val === undefined) return '';
          const str = String(val);
          // Escape quotes and wrap in quotes if contains comma/quote/newline
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join(',')
    );

    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${objectName}_preview.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <ModalPortal>
    { }
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      onClick={onClose}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId, descriptionId)}
        className="bg-parchment rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col m-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen flex items-center justify-between">
          <div>
            <h2 id={titleId} className="m-0 text-lg font-semibold text-ink">
              Preview: {objectName}
            </h2>
            {data && (
              <p id={descriptionId} className="mt-1 mb-0 text-sm text-archive">
                {data.truncated
                  ? `Showing ${data.rows.length} of ${data.total_rows != null ? formatNumber(data.total_rows) : 'many'} rows`
                  : `${data.rows.length} rows`}
                {data.query_time_ms && ` - ${data.query_time_ms}ms`}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {data && data.rows.length > 0 && (
              <button
                onClick={handleExportCSV}
                className="px-4 py-2 border border-stone rounded-sm bg-parchment text-sm text-ink hover:bg-stone/20 transition-colors inline-flex items-center gap-1.5"
              >
                <Download size={14} aria-hidden="true" />
                Export CSV
              </button>
            )}
            <button
              onClick={loadData}
              disabled={loading}
              className="p-2 border border-stone rounded-sm bg-parchment text-archive hover:bg-stone/20 transition-colors"
              aria-label="Refresh data"
            >
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            </button>
            <button
              onClick={onClose}
              className="p-2 border border-stone rounded-sm bg-parchment text-archive hover:bg-stone/20 transition-colors"
              aria-label="Close dialog"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {loading && !data && (
            <div className="flex items-center justify-center h-64">
              <RefreshCw size={32} className="text-bark animate-spin" />
            </div>
          )}

          {error && (
            <div className="p-6">
              <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-sm p-4 text-semantic-error">
                {error}
              </div>
            </div>
          )}

          {data && (
            <div className="overflow-auto h-full">
              <table className="w-full text-sm">
                <thead className="bg-parchment sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-archive uppercase tracking-wider border-b border-lichen bg-stone/30">
                      #
                    </th>
                    {data.columns.map((col) => (
                      <th
                        key={col}
                        className="px-3 py-2 text-left text-xs font-medium text-archive uppercase tracking-wider border-b border-lichen bg-parchment whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-lichen">
                  {data.rows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-parchment">
                      <td className="px-3 py-2 text-archive text-xs bg-stone border-r border-lichen">
                        {page * pageSize + idx + 1}
                      </td>
                      {data.columns.map((col) => (
                        <td
                          key={col}
                          className="px-3 py-2 text-ink whitespace-nowrap max-w-xs truncate"
                          title={String(row[col] ?? '')}
                        >
                          {row[col] === null ? (
                            <span className="text-archive italic">null</span>
                          ) : typeof row[col] === 'object' ? (
                            <span className="font-mono text-xs text-bark">
                              {JSON.stringify(row[col])}
                            </span>
                          ) : (
                            String(row[col])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              {data.rows.length === 0 && (
                <div className="text-center py-12 text-archive">
                  No data found
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer with pagination */}
        {data && data.rows.length > 0 && (
          <div className="px-6 py-4 border-t border-lichen flex items-center justify-between bg-parchment">
            <div className="text-sm text-archive">
              Showing {page * pageSize + 1} -{' '}
              {Math.min((page + 1) * pageSize, data.total_rows || data.rows.length)}{' '}
              {data.total_rows != null && `of ${formatNumber(data.total_rows)}`}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0 || loading}
                className="p-1.5 border border-stone rounded-sm bg-parchment hover:bg-stone/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm text-ink px-2">
                Page {page + 1}
              </span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={
                  loading ||
                  !data.truncated ||
                  data.rows.length < pageSize
                }
                className="p-1.5 border border-stone rounded-sm bg-parchment hover:bg-stone/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
    </ModalPortal>
  );
}
