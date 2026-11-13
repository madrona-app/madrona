import { useId, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FileUp } from 'lucide-react';
import { apiFetch, getFriendlyErrorMessage } from '../../lib/apiClient';

interface PreviewRecord {
  number: string;
  level: string;
  title: string;
  parent_number: string | null;
}
interface PreviewResponse {
  dry_run: true;
  records: PreviewRecord[];
  total: number;
  by_level: Record<string, number>;
  warnings: string[];
  conflicts: string[];
}
interface ImportResponse {
  dry_run: false;
  root_object_id: string;
  created: number;
  by_level: Record<string, number>;
  warnings: string[];
}

const LEVEL_LABEL: Record<string, string> = {
  collection: 'Collection', subcollection: 'Sub-collection', series: 'Series', subseries: 'Sub-series',
  file: 'File', box: 'Box', folder: 'Folder', item: 'Item',
};

async function send(orgId: string, file: File, dryRun: boolean) {
  const form = new FormData();
  form.append('file', file);
  form.append('dry_run', dryRun ? 'true' : 'false');
  return apiFetch<PreviewResponse | ImportResponse>(`/organizations/${orgId}/collections/ead/import`, {
    method: 'POST',
    body: form,
  });
}

/** Upload an EAD 2002 finding aid, preview the records it creates, then import. */
export default function EadImportPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const focusResult = () => requestAnimationFrame(() => resultRef.current?.focus());

  const doPreview = async () => {
    if (!file || !orgId) {
      setError('Choose an EAD file first.');
      fileRef.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    setStatus('Reading the finding aid');
    try {
      const r = (await send(orgId, file, true)) as PreviewResponse;
      setPreview(r);
      setStatus(`Preview ready: ${r.total} records${r.conflicts.length ? `, ${r.conflicts.length} numbers already exist` : ''}`);
      focusResult();
    } catch (e) {
      const m = getFriendlyErrorMessage(e);
      setError(m);
      setStatus(m);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    if (!file || !orgId) return;
    setBusy(true);
    setError('');
    setStatus('Importing');
    try {
      const r = (await send(orgId, file, false)) as ImportResponse;
      setResult(r);
      setPreview(null);
      setStatus(`Imported ${r.created} records`);
      focusResult();
    } catch (e) {
      const m = getFriendlyErrorMessage(e);
      setError(m);
      setStatus(m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink flex items-center gap-2">
          <FileUp size={22} aria-hidden="true" className="text-bark" />
          Import a finding aid (EAD)
        </h1>
        <p className="text-sm text-archive mt-1">
          Creates a collection record and the series, boxes, folders and items below it from an EAD 2002 file.
          You see every record before anything is created.
        </p>
      </div>
      <div role="status" aria-live="polite" className="sr-only">{status}</div>

      <form onSubmit={(e) => { e.preventDefault(); doPreview(); }} className="space-y-3">
        <div>
          <label htmlFor={`${id}-file`} className="block text-sm font-medium text-ink mb-1">EAD file (.xml)</label>
          <input
            ref={fileRef}
            id={`${id}-file`}
            type="file"
            accept=".xml,application/xml,text/xml"
            aria-describedby={error ? `${id}-err` : undefined}
            aria-invalid={!!error && !file}
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResult(null); setError(''); }}
            className="block text-sm text-ink file:mr-3 file:btn-secondary"
          />
        </div>
        {error && <p id={`${id}-err`} role="alert" className="text-sm text-semantic-error">{error}</p>}
        <button type="submit" className="btn-primary text-sm" disabled={busy}>
          {busy && !preview ? 'Reading…' : 'Preview import'}
        </button>
      </form>

      {preview && (
        <section aria-labelledby={`${id}-preview`} className="space-y-3">
          <h2 ref={resultRef} tabIndex={-1} id={`${id}-preview`} className="text-lg font-semibold text-ink focus-visible:outline-none">
            Preview: {preview.total} records
          </h2>
          <p className="text-sm text-ink">
            {Object.entries(preview.by_level).map(([k, v]) => `${v} ${LEVEL_LABEL[k] ?? k}`).join(', ')}.
          </p>
          {preview.conflicts.length > 0 && (
            <div className="text-sm text-semantic-error bg-semantic-error/10 rounded p-3">
              <p className="font-medium">These object numbers already exist, so the import cannot run:</p>
              <ul className="list-disc ml-5">{preview.conflicts.slice(0, 20).map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
          )}
          {preview.warnings.length > 0 && (
            <div className="text-sm text-semantic-warning bg-semantic-warning/10 rounded p-3">
              <p className="font-medium">Warnings</p>
              <ul className="list-disc ml-5">{preview.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
          <button type="button" className="btn-primary text-sm" disabled={busy || preview.conflicts.length > 0} onClick={doImport}>
            {busy ? 'Importing…' : `Import ${preview.total} ${preview.total === 1 ? 'record' : 'records'}`}
          </button>
          {/* Focusable so keyboard users can scroll a wide table (axe scrollable-region-focusable). */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
          <div className="overflow-x-auto" role="region" aria-labelledby={`${id}-cap`} tabIndex={0}>
            <table className="w-full text-sm border border-lichen rounded-lg">
              <caption id={`${id}-cap`} className="text-left text-sm font-medium text-ink mb-1">
                Records to be created{preview.total > preview.records.length ? ` (first ${preview.records.length})` : ''}
              </caption>
              <thead className="bg-stone/50">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Number</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Level</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Title</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Inside</th>
                </tr>
              </thead>
              <tbody>
                {preview.records.map((r) => (
                  <tr key={r.number} className="border-t border-lichen">
                    <th scope="row" className="px-3 py-2 text-left font-normal text-ink">{r.number}</th>
                    <td className="px-3 py-2 text-ink">{LEVEL_LABEL[r.level] ?? r.level}</td>
                    <td className="px-3 py-2 text-ink">{r.title}</td>
                    <td className="px-3 py-2 text-archive">{r.parent_number ?? 'Top level'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {result && (
        <section aria-labelledby={`${id}-done`}>
          <h2 ref={resultRef} tabIndex={-1} id={`${id}-done`} className="text-lg font-semibold text-ink focus-visible:outline-none">
            Imported {result.created} records
          </h2>
          <p className="text-sm text-ink mt-1">
            <Link to={`/organizations/${orgId}/collections/objects/${result.root_object_id}`}
              className="text-bark hover:text-copper-dark underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2">
              Open the collection record
            </Link>
          </p>
        </section>
      )}
    </div>
  );
}
