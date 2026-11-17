/**
 * Labels for file attachments: short type ("PDF", "BRF") and human size
 * ("120 KB"), used to build download link names such as
 * "Download Purchase invoice (PDF, 120 KB)".
 */

const MIME_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/x-brf': 'BRF',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'text/plain': 'TXT',
  'text/csv': 'CSV',
  'text/html': 'HTML',
};

/** Short file type, from the file extension first, then the MIME type. */
export function attachmentTypeLabel(file: {
  media_filename?: string | null;
  media_mime_type?: string | null;
}): string {
  const name = file.media_filename || '';
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) return name.slice(dot + 1).toUpperCase();
  const mime = file.media_mime_type;
  if (mime && MIME_LABELS[mime]) return MIME_LABELS[mime];
  if (mime) return (mime.split('/').pop() || mime).toUpperCase();
  return 'file';
}

/** Human file size, e.g. "500 bytes", "120 KB", "3.4 MB"; null when unknown. */
export function attachmentSizeLabel(bytes: number | null | undefined): string | null {
  if (!bytes || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} bytes`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
