/**
 * Convert a snake_case field name to Title Case for display.
 * e.g. "object_title" → "Object Title"
 */
export function formatFieldName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());
}
