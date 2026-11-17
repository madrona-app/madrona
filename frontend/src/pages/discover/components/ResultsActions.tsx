/**
 * ResultsActions — permalink and export controls for a group of objects.
 *
 * - "Copy link to these results" copies the canonical results URL and
 *   announces the outcome in a polite live region (the button label does not
 *   change, so focus stays on a stable control).
 * - Export links download the group as CSV or JSON from the public export
 *   endpoints. Their names state the format and how many records the file
 *   will hold, and the cap is stated in visible text.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Link2 } from 'lucide-react';
import { formatNumber } from '@/lib/formatters';

/** Mirrors EXPORT_MAX_OBJECTS in backend discover_public.py. */
export const DISCOVER_EXPORT_CAP = 500;

const CONTROL_CLASS =
  'inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded border border-lichen bg-parchment text-sm text-bark hover:text-copper-dark hover:border-bark/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

interface ResultsActionsProps {
  /** Total number of records in the group. */
  total: number;
  /** [singular, plural] noun for the group, e.g. ['result', 'results']. */
  noun: [string, string];
  /** Absolute or root-relative URL to copy; omit to hide the copy control. */
  permalink?: string;
  copyLabel?: string;
  csvUrl: string;
  jsonUrl: string;
  /** id prefix so two instances on a page stay unique. */
  idPrefix?: string;
}

export function ResultsActions({
  total,
  noun,
  permalink,
  copyLabel = 'Copy link to these results',
  csvUrl,
  jsonUrl,
  idPrefix = 'results',
}: ResultsActionsProps) {
  const [status, setStatus] = useState('');
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
  }, []);

  const fullUrl = permalink
    ? permalink.startsWith('http')
      ? permalink
      : `${window.location.origin}${permalink}`
    : '';

  const handleCopy = useCallback(async () => {
    const ok = await copyText(fullUrl);
    // Clear first so repeating the same message is announced again.
    setStatus('');
    window.setTimeout(() => {
      setStatus(ok ? 'Link copied to clipboard.' : `Could not copy automatically. The link is ${fullUrl}`);
    }, 50);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    if (ok) clearTimer.current = setTimeout(() => setStatus(''), 6000);
  }, [fullUrl]);

  const capped = total > DISCOVER_EXPORT_CAP;
  const count = capped ? DISCOVER_EXPORT_CAP : total;
  const what = capped
    ? `the first ${formatNumber(DISCOVER_EXPORT_CAP)} of ${formatNumber(total)} ${noun[1]}`
    : total === 1
      ? `this 1 ${noun[0]}`
      : `these ${formatNumber(total)} ${noun[1]}`;
  const noteId = `${idPrefix}-export-note`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {permalink && (
          <button type="button" onClick={handleCopy} className={CONTROL_CLASS}>
            <Link2 size={16} aria-hidden="true" />
            {copyLabel}
          </button>
        )}
        {total > 0 && (
          <>
            <a href={csvUrl} download className={CONTROL_CLASS} aria-describedby={noteId}>
              <Download size={16} aria-hidden="true" />
              Download {what} as CSV
            </a>
            <a href={jsonUrl} download className={CONTROL_CLASS} aria-describedby={noteId}>
              <Download size={16} aria-hidden="true" />
              Download {what} as JSON
            </a>
          </>
        )}
      </div>
      {total > 0 && (
        <p id={noteId} className="text-xs text-archive">
          Downloads include up to {formatNumber(DISCOVER_EXPORT_CAP)} records
          {capped ? ` (${formatNumber(count)} of ${formatNumber(total)} here)` : ''}, with the public
          information shown on each object page. CSV opens in spreadsheet programs; JSON is for software.
        </p>
      )}
      <p role="status" aria-live="polite" className="text-xs text-ink min-h-[1rem]">
        {status}
      </p>
    </div>
  );
}
