import type { AuditCheckListItem } from '../../../lib/api';

export const OUTCOME_LABELS: Record<string, string> = {
  pending: 'Not checked',
  found: 'Found',
  not_found: 'Not found',
  wrong_location: 'Wrong location',
};

function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  // Spreadsheet formula injection guard.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCheckListCsv(items: AuditCheckListItem[]): string {
  const header = ['Sequence', 'Object number', 'Title', 'Expected location', 'Expected location path', 'Result', 'Found location', 'Checked at', 'Note'];
  const rows = items.map((i) => [
    i.check_sequence, i.object_number, i.title, i.expected_location_name, i.expected_location_path,
    OUTCOME_LABELS[i.outcome] ?? i.outcome, i.actual_location_name, i.checked_at, i.note,
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function downloadCsv(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

