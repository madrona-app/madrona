/**
 * Bridge file source: upload a .csv or .xlsx, choose the sheet and header
 * row, review the detected columns and first rows, map columns to object
 * fields, and create the source connector.
 *
 * Accessibility: native file input and selects with visible labels; upload
 * progress uses <progress>; every state change (uploading, preview ready,
 * error, created) is announced through one polite live region, errors also
 * through role="alert" tied to the input with aria-describedby; focus moves
 * to the preview heading once a file has been read.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { createConnectorInstance, previewConnectorFile } from '../lib/api';
import type { ConnectorFilePreview } from '../lib/api';
import type { ConnectorDefinition } from '../lib/schemas';
import { useAccessibleModal, getModalAriaProps } from '../hooks/useAccessibleModal';

interface FileSourceWizardProps {
  definition: ConnectorDefinition;
  organizationId: string;
  onComplete: (instanceId: string) => void;
  onCancel: () => void;
}

const ACCEPT = '.csv,.tsv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PRIMARY_TARGETS = ['object_number', 'title', 'object_name', 'description', 'creator', 'dated'];
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';
const FIELD = `w-full border border-lichen rounded-md px-3 py-2 bg-parchment-warm text-ink ${FOCUS_RING}`;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}

export default function FileSourceWizard({
  definition,
  organizationId,
  onComplete,
  onCancel,
}: FileSourceWizardProps) {
  const uid = useId().replace(/:/g, '');
  const ids = {
    name: `${uid}-name`,
    file: `${uid}-file`,
    fileHint: `${uid}-file-hint`,
    fileError: `${uid}-file-error`,
    sheet: `${uid}-sheet`,
    headerRow: `${uid}-header-row`,
    previewHeading: `${uid}-preview-heading`,
    mappingError: `${uid}-mapping-error`,
  };
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen: true,
    onClose: onCancel,
    titlePrefix: `file-source-${uid}`,
  });

  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ConnectorFilePreview | null>(null);
  const [sheet, setSheet] = useState('');
  const [headerRow, setHeaderRow] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState<'upload' | 'reread' | 'create' | null>(null);
  const [error, setError] = useState('');
  const [mappingError, setMappingError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusPreview = useRef(false);

  useEffect(() => {
    if (preview && focusPreview.current) {
      focusPreview.current = false;
      previewHeadingRef.current?.focus();
    }
  }, [preview]);

  const applyPreview = (result: ConnectorFilePreview, keepMapping: boolean) => {
    setPreview(result);
    setSheet(result.sheet_name ?? '');
    setHeaderRow(String(result.header_row));
    if (!keepMapping) setMapping(result.suggested_mapping);
    if (!name) setName(result.filename.replace(/\.[^.]+$/, ''));
    const where = result.sheet_name ? `, sheet ${result.sheet_name}` : '';
    setAnnouncement(
      `Read ${result.filename}${where}: ${result.total_rows} ${result.total_rows === 1 ? 'row' : 'rows'} and ${result.columns.length} columns. Preview below.`,
    );
  };

  const handleUpload = async () => {
    setError('');
    if (!file) {
      setError('Choose a .csv or .xlsx file first.');
      setAnnouncement('');
      return;
    }
    setBusy('upload');
    setProgress(0);
    setAnnouncement(`Uploading ${file.name}…`);
    try {
      const result = await previewConnectorFile({ organizationId, file }, setProgress);
      focusPreview.current = true;
      applyPreview(result, false);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Upload failed.';
      setError(message);
      setAnnouncement(''); // the role="alert" message announces it
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const handleReread = async () => {
    if (!preview) return;
    const row = headerRow.trim() ? Number(headerRow) : null;
    if (row !== null && (!Number.isInteger(row) || row < 1)) {
      setError('Header row must be a whole number, 1 or more.');
      return;
    }
    setError('');
    setBusy('reread');
    setAnnouncement('Updating preview…');
    try {
      const result = await previewConnectorFile({
        organizationId,
        storageKey: preview.storage_key,
        sheetName: sheet || null,
        headerRow: row,
      });
      const sameColumns = result.columns.join('\u0000') === preview.columns.join('\u0000');
      applyPreview(result, sameColumns);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not read the file.';
      setError(message);
      setAnnouncement(''); // the role="alert" message announces it
    } finally {
      setBusy(null);
    }
  };

  const handleCreate = async () => {
    if (!preview) return;
    if (!mapping.object_number) {
      setMappingError('Choose the column that holds the object number.');
      setAnnouncement('');
      document.getElementById(`${uid}-map-object_number`)?.focus();
      return;
    }
    setMappingError('');
    setBusy('create');
    setAnnouncement('Creating source…');
    try {
      const fieldMapping = Object.fromEntries(Object.entries(mapping).filter(([, col]) => col));
      const instance = await createConnectorInstance({
        organization_id: organizationId,
        connector_definition_id: definition.connector_definition_id,
        name: name.trim() || preview.filename,
        config: {
          storage_key: preview.storage_key,
          filename: preview.filename,
          file_format: preview.file_format,
          sheet_name: preview.sheet_name,
          header_row: preview.header_row,
          record_type: 'Object',
          field_mapping: fieldMapping,
        },
      });
      setAnnouncement(`Source ${instance.name} created.`);
      onComplete(instance.connector_instance_id);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not create the source.';
      setError(message);
      setAnnouncement(''); // the role="alert" message announces it
    } finally {
      setBusy(null);
    }
  };

  const targetsByKey = new Map((preview?.mapping_targets ?? []).map((t) => [t.key, t.label]));
  const primary = PRIMARY_TARGETS.filter((k) => targetsByKey.has(k));
  const secondary = (preview?.mapping_targets ?? []).map((t) => t.key).filter((k) => !PRIMARY_TARGETS.includes(k));

  const renderMappingSelect = (key: string) => {
    const id = `${uid}-map-${key}`;
    const required = key === 'object_number';
    return (
      <div key={key}>
        <label htmlFor={id} className="block text-sm font-medium text-ink mb-1">
          {required ? `${targetsByKey.get(key)} (required)` : targetsByKey.get(key)}
        </label>
        <select
          id={id}
          value={mapping[key] ?? ''}
          onChange={(e) => setMapping({ ...mapping, [key]: e.target.value })}
          className={FIELD}
          aria-required={required || undefined}
          aria-invalid={required && mappingError ? true : undefined}
          aria-describedby={required && mappingError ? ids.mappingError : undefined}
        >
          <option value="">Not mapped</option>
          {preview?.columns.map((col) => (
            <option key={col} value={col}>{col}</option>
          ))}
        </select>
      </div>
    );
  };

  return (
    <div
      ref={modalRef}
      {...getModalAriaProps(titleId, descriptionId)}
      className="bg-parchment rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto"
    >
      <div className="flex items-start justify-between px-6 py-4 border-b border-lichen">
        <div>
          <h2 id={titleId} className="text-xl font-semibold text-ink">Upload a spreadsheet</h2>
          <p id={descriptionId} className="text-sm text-archive mt-1">
            Each row becomes one object record. You can review the rows before anything is imported.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close upload dialog"
          className={`min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded text-archive hover:text-ink ${FOCUS_RING}`}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      <div className="p-6 space-y-6">
        <div role="status" aria-live="polite" className="sr-only">{announcement}</div>

        <div>
          <label htmlFor={ids.name} className="block text-sm font-medium text-ink mb-1">Source name</label>
          <input
            id={ids.name}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={FIELD}
            autoComplete="off"
          />
        </div>

        <div>
          <label htmlFor={ids.file} className="block text-sm font-medium text-ink mb-1">Spreadsheet file</label>
          <p id={ids.fileHint} className="text-sm text-archive mb-2">
            Accepted types: CSV (.csv, .tsv) or Excel workbook (.xlsx). Up to 25 MB and 50,000 rows.
            Older .xls files must be saved as .xlsx first.
          </p>
          <input
            id={ids.file}
            type="file"
            accept={ACCEPT}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setError('');
            }}
            aria-describedby={error ? `${ids.fileHint} ${ids.fileError}` : ids.fileHint}
            aria-invalid={error && !preview ? true : undefined}
            className={`block w-full text-sm text-ink file:mr-3 file:px-3 file:py-2 file:rounded file:border-0 file:bg-lichen file:text-ink ${FOCUS_RING}`}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleUpload}
              disabled={busy !== null}
              className={`btn-primary ${FOCUS_RING}`}
            >
              {busy === 'upload' ? 'Uploading…' : preview ? 'Upload a different file' : 'Upload and preview'}
            </button>
            {progress !== null && (
              <span className="flex items-center gap-2 text-sm text-archive">
                <label htmlFor={`${uid}-progress`}>Upload progress</label>
                <progress id={`${uid}-progress`} max={1} value={progress} className="w-40">
                  {Math.round(progress * 100)}%
                </progress>
                <span aria-hidden="true">{Math.round(progress * 100)}%</span>
              </span>
            )}
          </div>
          {error && (
            <p id={ids.fileError} role="alert" className="mt-2 text-sm text-semantic-error">{error}</p>
          )}
        </div>

        {preview && (
          <>
            <section aria-labelledby={ids.previewHeading} className="space-y-4">
              <h3
                id={ids.previewHeading}
                ref={previewHeadingRef}
                tabIndex={-1}
                className={`text-lg font-semibold text-ink ${FOCUS_RING}`}
              >
                Preview of {preview.filename}
              </h3>
              <p className="text-sm text-archive">
                {preview.total_rows} {preview.total_rows === 1 ? 'row' : 'rows'}, {formatBytes(preview.size_bytes)}
                {preview.file_format === 'csv' && preview.encoding ? `, ${preview.encoding} text` : ''}.
                Column headers read from row {preview.header_row}.
              </p>

              <fieldset className="border border-lichen rounded-md p-4">
                <legend className="px-1 text-sm font-medium text-ink">Reading options</legend>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                  {preview.sheets.length > 0 && (
                    <div>
                      <label htmlFor={ids.sheet} className="block text-sm font-medium text-ink mb-1">Sheet</label>
                      <select id={ids.sheet} value={sheet} onChange={(e) => setSheet(e.target.value)} className={FIELD}>
                        {preview.sheets.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label htmlFor={ids.headerRow} className="block text-sm font-medium text-ink mb-1">
                      Header row number
                    </label>
                    <input
                      id={ids.headerRow}
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={headerRow}
                      onChange={(e) => setHeaderRow(e.target.value)}
                      className={FIELD}
                    />
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={handleReread}
                      disabled={busy !== null}
                      className={`btn-secondary ${FOCUS_RING}`}
                    >
                      {busy === 'reread' ? 'Updating…' : 'Update preview'}
                    </button>
                  </div>
                </div>
              </fieldset>

              <div>
                <h4 className="text-base font-semibold text-ink mb-1">Detected columns</h4>
                <ul className="flex flex-wrap gap-2 text-sm" aria-label={`${preview.columns.length} detected columns`}>
                  {preview.columns.map((col) => (
                    <li key={col} className="px-2 py-0.5 rounded bg-lichen text-ink">{col}</li>
                  ))}
                </ul>
              </div>

              <div
                role="region"
                aria-labelledby={`${uid}-caption`}
                tabIndex={0}
                className={`overflow-x-auto border border-lichen rounded-md ${FOCUS_RING}`}
              >
                <table className="min-w-full text-sm text-left">
                  <caption id={`${uid}-caption`} className="text-left px-3 py-2 text-ink font-medium">
                    First {preview.preview_rows.length} of {preview.total_rows} rows
                    {preview.sheet_name ? ` from sheet ${preview.sheet_name}` : ''}
                  </caption>
                  <thead className="bg-lichen">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-semibold text-ink">Row</th>
                      {preview.columns.map((col) => (
                        <th key={col} scope="col" className="px-3 py-2 font-semibold text-ink whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview_rows.map((row) => (
                      <tr key={row.row_number} className="border-t border-lichen">
                        <th scope="row" className="px-3 py-2 font-normal text-archive">{row.row_number}</th>
                        {preview.columns.map((col) => (
                          <td key={col} className="px-3 py-2 text-ink align-top whitespace-pre-line">
                            {row.values[col] ?? <span className="sr-only">empty</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section aria-labelledby={`${uid}-mapping-heading`}>
              <h3 id={`${uid}-mapping-heading`} className="text-lg font-semibold text-ink mb-1">Map columns</h3>
              <fieldset>
                <legend className="text-sm text-archive mb-3">
                  Choose which column fills each object field. Suggestions are based on the column headers.
                </legend>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{primary.map(renderMappingSelect)}</div>
                {secondary.length > 0 && (
                  <details className="mt-4">
                    <summary className={`cursor-pointer text-sm text-bark hover:text-copper-dark ${FOCUS_RING}`}>
                      More object fields ({secondary.length})
                    </summary>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">{secondary.map(renderMappingSelect)}</div>
                  </details>
                )}
                {mappingError && (
                  <p id={ids.mappingError} role="alert" className="mt-2 text-sm text-semantic-error">{mappingError}</p>
                )}
              </fieldset>
            </section>
          </>
        )}
      </div>

      <div className="flex justify-end gap-3 px-6 py-4 border-t border-lichen">
        <button type="button" onClick={onCancel} className={`btn-tertiary ${FOCUS_RING}`}>Cancel</button>
        <button
          type="button"
          onClick={handleCreate}
          disabled={!preview || busy !== null}
          className={`btn-primary ${FOCUS_RING}`}
        >
          {busy === 'create' ? 'Creating…' : 'Create source'}
        </button>
      </div>
    </div>
  );
}
