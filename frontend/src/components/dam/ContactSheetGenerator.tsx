/**
 * ContactSheetGenerator — generate PDF proof sheets from a media collection.
 * Dispatches async Celery task, polls for completion, then triggers download.
 */
import { useState, useEffect, useCallback } from 'react';
import Checkbox from '../Checkbox';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FileDown, Loader2 } from 'lucide-react';
import { generateContactSheet } from '../../lib/api/media-dam';
import { getReportRun, getReportDownloadUrl } from '../../lib/api/on-demand-reports';
import { useToast } from '../../contexts/ToastContext';

interface ContactSheetGeneratorProps {
  organizationId: string;
  collectionId: string;
  collectionTitle?: string;
}

const LAYOUTS = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
  { value: 'detail', label: 'Detail' },
] as const;

const PAGE_SIZES = [
  { value: 'letter', label: 'Letter (8.5 x 11")' },
  { value: 'a4', label: 'A4 (210 x 297mm)' },
  { value: 'tabloid', label: 'Tabloid (11 x 17")' },
] as const;

export function ContactSheetGenerator({
  organizationId,
  collectionId,
  collectionTitle,
}: ContactSheetGeneratorProps) {
  const { showToast } = useToast();

  const [layout, setLayout] = useState('grid');
  const [pageSize, setPageSize] = useState('letter');
  const [columns, setColumns] = useState(4);
  const [includeTitle, setIncludeTitle] = useState(true);
  const [includeFilename, setIncludeFilename] = useState(true);
  const [includeDescription, setIncludeDescription] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  // Dispatch the async task
  const mutation = useMutation({
    mutationFn: () =>
      generateContactSheet(organizationId, collectionId, {
        layout,
        page_size: pageSize,
        columns,
        include_title: includeTitle,
        include_filename: includeFilename,
        include_description: includeDescription,
      }),
    onSuccess: (data) => {
      setActiveRunId(data.run_id);
    },
    onError: (error: Error) => {
      showToast({ title: `Failed: ${error.message}`, type: 'error' });
    },
  });

  // Poll for completion
  const { data: runData } = useQuery({
    queryKey: ['report-run', organizationId, activeRunId],
    queryFn: () => getReportRun(organizationId, activeRunId!),
    enabled: !!activeRunId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'pending' || status === 'running') return 3000;
      return false;
    },
  });

  // Auto-download when completed
  const handleDownload = useCallback(async () => {
    if (!activeRunId) return;
    try {
      const { download_url } = await getReportDownloadUrl(organizationId, activeRunId);
      const link = document.createElement('a');
      link.href = download_url;
      link.download = `contact-sheet-${collectionTitle || collectionId.slice(0, 8)}.pdf`;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast({ title: 'Contact sheet downloaded', type: 'success' });
    } catch {
      showToast({ title: 'Failed to download', type: 'error' });
    }
    setActiveRunId(null);
  }, [activeRunId, organizationId, collectionId, collectionTitle, showToast]);

  useEffect(() => {
    if (runData?.status === 'completed') {
      handleDownload();
    } else if (runData?.status === 'failed') {
      showToast({ title: `Generation failed: ${runData.error_message || 'Unknown error'}`, type: 'error' });
      setActiveRunId(null);
    }
  }, [runData?.status]);

  const isGenerating = mutation.isPending || (!!activeRunId && runData?.status !== 'completed' && runData?.status !== 'failed');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-archive block mb-1">Layout</label>
          <select
            value={layout}
            onChange={(e) => setLayout(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-lichen rounded bg-parchment"
          >
            {LAYOUTS.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-archive block mb-1">Page Size</label>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-lichen rounded bg-parchment"
          >
            {PAGE_SIZES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-archive block mb-1">Columns</label>
          <input
            type="number"
            min={1}
            max={8}
            value={columns}
            onChange={(e) => setColumns(parseInt(e.target.value) || 4)}
            disabled={layout !== 'grid'}
            className="w-full px-2 py-1.5 text-sm border border-lichen rounded disabled:opacity-50"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-sm text-ink cursor-pointer">
          <Checkbox checked={includeTitle} onChange={(e) => setIncludeTitle(e.target.checked)} />
          Title
        </label>
        <label className="flex items-center gap-1.5 text-sm text-ink cursor-pointer">
          <Checkbox checked={includeFilename} onChange={(e) => setIncludeFilename(e.target.checked)} />
          Filename
        </label>
        <label className="flex items-center gap-1.5 text-sm text-ink cursor-pointer">
          <Checkbox checked={includeDescription} onChange={(e) => setIncludeDescription(e.target.checked)} />
          Description
        </label>
      </div>

      <button
        onClick={() => mutation.mutate()}
        disabled={isGenerating}
        className="btn btn-primary w-full inline-flex items-center justify-center gap-2"
      >
        {isGenerating ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            {activeRunId ? 'Generating...' : 'Queuing...'}
          </>
        ) : (
          <>
            <FileDown size={16} />
            Generate Contact Sheet
          </>
        )}
      </button>
    </div>
  );
}

export default ContactSheetGenerator;
