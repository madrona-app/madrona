/**
 * Export controls for collection objects.
 *
 * - ObjectListExportControls: on the objects list — choose a format (CSV,
 *   Excel, JSON-LD) and which objects (the current results, or the active
 *   work set), then Export.
 * - ObjectJsonLdExportButton: on an object record — export it as JSON-LD.
 * - RightsExportControls: on Rights Management — export rights records
 *   (including rights holder and agent for rights holder) as CSV or Excel.
 *
 * Exports are synchronous on the backend, so the file comes back in the
 * response: the browser download starts automatically and a named link to
 * the same file stays on the page in case the download was blocked. Progress
 * and completion are announced in a role="status" region; failures in
 * role="alert". Native <select>s and plain buttons, no custom menu widget.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { Download, FileDown, Loader2 } from 'lucide-react';
import {
  MAX_EXPORT_OBJECTS,
  exportCollectionObjectsJsonLd,
  exportCollectionObjectsTable,
  exportObjectJsonLd,
  exportObjectRightsTable,
  type ExportFile,
  type ObjectExportFormat,
  type ObjectExportScope,
} from '../../lib/api/collectionsExport';
import { attachmentSizeLabel } from '../../lib/attachmentLabels';
import { formatNumber } from '@/lib/formatters';
import type { CollectionsSearchFilters } from '../../lib/schemas/entities';

const FORMAT_LABELS: Record<ObjectExportFormat, string> = {
  csv: 'CSV',
  excel: 'Excel',
  jsonld: 'JSON-LD',
};

interface ReadyFile {
  url: string;
  filename: string;
  label: string;
}

/** Holds the latest export as an object URL and starts its download. */
function useExportFile() {
  const [ready, setReady] = useState<ReadyFile | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const clear = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setReady(null);
  };

  const deliver = (file: ExportFile, typeLabel: string) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(file.blob);
    urlRef.current = url;
    const size = attachmentSizeLabel(file.blob.size);
    setReady({
      url,
      filename: file.filename,
      label: `Download ${file.filename} (${typeLabel}${size ? `, ${size}` : ''})`,
    });
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    try {
      a.click();
    } finally {
      document.body.removeChild(a);
    }
  };

  return { ready, deliver, clear };
}

function ReadyLink({ ready }: { ready: ReadyFile }) {
  return (
    <a
      href={ready.url}
      download={ready.filename}
      className="inline-flex items-center gap-2 text-sm text-bark hover:text-copper-dark underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
    >
      <Download size={14} aria-hidden="true" />
      {ready.label}
    </a>
  );
}

function objectsPhrase(count: number): string {
  return count === 1 ? '1 object' : `${formatNumber(count)} objects`;
}

export interface ObjectListExportControlsProps {
  organizationId: string;
  /** Current list search text (debounced, as sent to search). */
  searchQuery?: string;
  /** Current list filters. */
  filters?: CollectionsSearchFilters;
  /** Number of objects in the current results, when known. */
  resultCount?: number;
  /** The user's active collections work set, if any. */
  activeWorkspace?: { workspace_id: string; name: string; object_count: number } | null;
}

export function ObjectListExportControls({
  organizationId,
  searchQuery,
  filters,
  resultCount,
  activeWorkspace,
}: ObjectListExportControlsProps) {
  const uid = useId();
  const ids = {
    heading: `${uid}-heading`,
    format: `${uid}-format`,
    scope: `${uid}-scope`,
    note: `${uid}-note`,
  };
  const [format, setFormat] = useState<ObjectExportFormat>('csv');
  const [scopeChoice, setScopeChoice] = useState<'results' | 'workspace'>('results');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { ready, deliver, clear } = useExportFile();

  const hasSearch = !!searchQuery || (!!filters && Object.keys(filters).length > 0);
  const workspaceAvailable = !!activeWorkspace && activeWorkspace.object_count > 0;
  const useWorkspace = scopeChoice === 'workspace' && workspaceAvailable;
  const count = useWorkspace ? activeWorkspace!.object_count : resultCount;
  const overCap = typeof count === 'number' && count > MAX_EXPORT_OBJECTS;

  const resultsLabel = hasSearch
    ? `Current search results${typeof resultCount === 'number' ? ` (${objectsPhrase(resultCount)})` : ''}`
    : `All objects${typeof resultCount === 'number' ? ` (${objectsPhrase(resultCount)})` : ''}`;

  const handleExport = async () => {
    const scope: ObjectExportScope = useWorkspace
      ? { kind: 'workspace', workspaceId: activeWorkspace!.workspace_id }
      : hasSearch
        ? { kind: 'search', query: searchQuery || undefined, filters }
        : { kind: 'all' };
    const what = useWorkspace
      ? `work set ${activeWorkspace!.name}`
      : hasSearch
        ? 'the current search results'
        : 'all objects';
    const fmt = FORMAT_LABELS[format];
    setBusy(true);
    setError(null);
    clear();
    setStatus(`Preparing ${fmt} export of ${what}…`);
    try {
      const file =
        format === 'jsonld'
          ? await exportCollectionObjectsJsonLd(organizationId, scope, (done, total) => {
              setStatus(
                total !== null
                  ? `Exporting ${fmt}: ${formatNumber(done)} of ${objectsPhrase(total)}…`
                  : `Exporting ${fmt}: ${objectsPhrase(done)} so far…`,
              );
            })
          : await exportCollectionObjectsTable(organizationId, format, scope);
      deliver(file, fmt);
      setStatus(`${fmt} export ready: ${file.filename}. The download has started.`);
    } catch (err) {
      setStatus('');
      setError(`Export failed: ${(err as Error).message || 'the server did not return a file.'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby={ids.heading}
      className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6"
    >
      <h2 id={ids.heading} className="text-sm font-medium text-ink mb-3 flex items-center gap-2">
        <FileDown size={16} className="text-archive" aria-hidden="true" />
        Export objects
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={ids.format} className="block text-sm text-ink mb-1">
            Format
          </label>
          <select
            id={ids.format}
            value={format}
            onChange={(e) => setFormat(e.target.value as ObjectExportFormat)}
            disabled={busy}
            className="min-h-[44px] px-3 py-2 text-sm border border-lichen rounded-lg bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          >
            <option value="csv">CSV</option>
            <option value="excel">Excel (.xlsx)</option>
            <option value="jsonld">JSON-LD (linked data)</option>
          </select>
        </div>
        {workspaceAvailable ? (
          <div>
            <label htmlFor={ids.scope} className="block text-sm text-ink mb-1">
              Objects
            </label>
            <select
              id={ids.scope}
              value={useWorkspace ? 'workspace' : 'results'}
              onChange={(e) => setScopeChoice(e.target.value as 'results' | 'workspace')}
              disabled={busy}
              aria-describedby={overCap ? ids.note : undefined}
              className="min-h-[44px] px-3 py-2 text-sm border border-lichen rounded-lg bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              <option value="results">{resultsLabel}</option>
              <option value="workspace">
                Active work set: {activeWorkspace!.name} ({objectsPhrase(activeWorkspace!.object_count)})
              </option>
            </select>
          </div>
        ) : (
          <p className="text-sm text-ink min-h-[44px] flex items-center">
            Objects: {resultsLabel}
          </p>
        )}
        <button
          type="button"
          onClick={handleExport}
          disabled={busy}
          aria-describedby={overCap ? ids.note : undefined}
          className="btn btn-secondary text-sm min-h-[44px] inline-flex items-center gap-2"
        >
          {busy ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            <FileDown size={16} aria-hidden="true" />
          )}
          {busy ? 'Exporting…' : 'Export'}
        </button>
      </div>
      {overCap && (
        <p id={ids.note} className="text-xs text-accessible-gray mt-2">
          Exports include the first {formatNumber(MAX_EXPORT_OBJECTS)} objects.
        </p>
      )}
      <div role="status" aria-live="polite" aria-atomic="true" className="text-sm text-ink mt-2">
        {status}
      </div>
      {error && (
        <p role="alert" className="text-sm text-semantic-error mt-2">
          {error}
        </p>
      )}
      {ready && (
        <p className="mt-2">
          <ReadyLink ready={ready} />
        </p>
      )}
    </section>
  );
}

export interface ObjectJsonLdExportButtonProps {
  organizationId: string;
  objectId: string;
  objectNumber?: string | null;
}

export function ObjectJsonLdExportButton({
  organizationId,
  objectId,
  objectNumber,
}: ObjectJsonLdExportButtonProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { ready, deliver, clear } = useExportFile();
  const name = objectNumber ? `object ${objectNumber}` : 'this object';

  const handleExport = async () => {
    setBusy(true);
    setError(null);
    clear();
    setStatus(`Preparing JSON-LD export of ${name}…`);
    try {
      const file = await exportObjectJsonLd(organizationId, objectId, objectNumber);
      deliver(file, 'JSON-LD');
      setStatus(`JSON-LD export ready: ${file.filename}. The download has started.`);
    } catch (err) {
      setStatus('');
      setError(`JSON-LD export failed: ${(err as Error).message || 'the server did not return a file.'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleExport}
        disabled={busy}
        className="btn btn-secondary text-sm min-h-[44px] inline-flex items-center gap-2"
      >
        {busy ? (
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        ) : (
          <FileDown size={16} aria-hidden="true" />
        )}
        {busy ? 'Exporting JSON-LD…' : 'Export JSON-LD'}
      </button>
      <div role="status" aria-live="polite" aria-atomic="true" className="text-sm text-ink">
        {status}
      </div>
      {error && (
        <p role="alert" className="text-sm text-semantic-error">
          {error}
        </p>
      )}
      {ready && <ReadyLink ready={ready} />}
    </div>
  );
}

export interface RightsExportControlsProps {
  organizationId: string;
}

export function RightsExportControls({ organizationId }: RightsExportControlsProps) {
  const uid = useId();
  const headingId = `${uid}-heading`;
  const formatId = `${uid}-format`;
  const [format, setFormat] = useState<'csv' | 'excel'>('csv');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { ready, deliver, clear } = useExportFile();

  const handleExport = async () => {
    const fmt = format === 'csv' ? 'CSV' : 'Excel';
    setBusy(true);
    setError(null);
    clear();
    setStatus(`Preparing ${fmt} export of rights records…`);
    try {
      const file = await exportObjectRightsTable(organizationId, format);
      deliver(file, fmt);
      setStatus(`${fmt} export ready: ${file.filename}. The download has started.`);
    } catch (err) {
      setStatus('');
      setError(`Export failed: ${(err as Error).message || 'the server did not return a file.'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6"
    >
      <h2 id={headingId} className="text-sm font-medium text-ink mb-3 flex items-center gap-2">
        <FileDown size={16} className="text-archive" aria-hidden="true" />
        Export rights records
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={formatId} className="block text-sm text-ink mb-1">
            Format
          </label>
          <select
            id={formatId}
            value={format}
            onChange={(e) => setFormat(e.target.value as 'csv' | 'excel')}
            disabled={busy}
            className="min-h-[44px] px-3 py-2 text-sm border border-lichen rounded-lg bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          >
            <option value="csv">CSV</option>
            <option value="excel">Excel (.xlsx)</option>
          </select>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={busy}
          className="btn btn-secondary text-sm min-h-[44px] inline-flex items-center gap-2"
        >
          {busy ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            <FileDown size={16} aria-hidden="true" />
          )}
          {busy ? 'Exporting…' : 'Export rights'}
        </button>
      </div>
      <p className="text-xs text-accessible-gray mt-2">
        Includes the rights holder and the agent for the rights holder.
      </p>
      <div role="status" aria-live="polite" aria-atomic="true" className="text-sm text-ink mt-2">
        {status}
      </div>
      {error && (
        <p role="alert" className="text-sm text-semantic-error mt-2">
          {error}
        </p>
      )}
      {ready && (
        <p className="mt-2">
          <ReadyLink ready={ready} />
        </p>
      )}
    </section>
  );
}
