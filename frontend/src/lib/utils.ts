import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind CSS classes with proper conflict resolution
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a timestamp to a relative time string (e.g., "3 minutes ago").
 *
 * @deprecated Import `formatRelativeTime` from `@/lib/formatters` instead.
 */
export { formatRelativeTime } from './formatters';

/**
 * Format duration in milliseconds to a human-readable string
 */
export function formatDuration(ms: number | null | undefined): string {
  if (!ms) return '—';
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Get a human-friendly status label
 */
export function getStatusLabel(status: string): string {
  const statusMap: Record<string, string> = {
    success: 'All set',
    running: 'Syncing…',
    publishing: 'Syncing…',
    failed: 'Needs attention',
    failed_publish: 'Needs attention',
    failed_finalize: 'Needs attention',
    pending: 'Queued',
    queued: 'Queued',
    warning: 'Completed with warnings',
    canceled: 'Canceled',
    rolled_back: 'Rolled back',
  };

  return statusMap[status] || status;
}

/**
 * Check if a run status is terminal (not running)
 */
export function isTerminalStatus(status: string): boolean {
  return ['success', 'failed', 'failed_publish', 'failed_finalize', 'warning', 'canceled', 'rolled_back'].includes(status);
}

/**
 * Check if a run status indicates the pipeline is actively processing
 */
export function isActiveStatus(status: string): boolean {
  return ['running', 'publishing', 'pending', 'queued'].includes(status);
}

/**
 * Get status color for badges/pills
 */
export function getStatusColor(status: string): string {
  if (status === 'success') return 'green';
  if (['running', 'publishing', 'pending', 'queued'].includes(status)) return 'blue';
  if (['failed', 'failed_publish', 'failed_finalize'].includes(status)) return 'red';
  if (status === 'warning') return 'yellow';
  if (['canceled', 'rolled_back'].includes(status)) return 'gray';
  return 'gray';
}

/**
 * Format file size in bytes to human-readable format
 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '—';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let size = bytes;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Get accent colors for collection object types - creates visual variety in gallery view
 * Colors derived from the Madrona institutional palette
 */
export function getObjectTypeColor(objectType: string | null | undefined): {
  bg: string;
  border: string;
  text: string;
  accent: string;
} {
  const typeColors: Record<string, { bg: string; border: string; text: string; accent: string }> = {
    painting: { bg: 'bg-bark/10', border: 'border-bark/30', text: 'text-bark', accent: 'bg-bark' },
    sculpture: { bg: 'bg-forest/10', border: 'border-forest/30', text: 'text-forest', accent: 'bg-forest' },
    photograph: { bg: 'bg-archive/10', border: 'border-archive/30', text: 'text-archive', accent: 'bg-archive' },
    textile: { bg: 'bg-copper/10', border: 'border-copper/30', text: 'text-copper', accent: 'bg-copper' },
    ceramic: { bg: 'bg-semantic-warning/10', border: 'border-semantic-warning/30', text: 'text-semantic-warning', accent: 'bg-semantic-warning' },
    ceramics: { bg: 'bg-semantic-warning/10', border: 'border-semantic-warning/30', text: 'text-semantic-warning', accent: 'bg-semantic-warning' },
    print: { bg: 'bg-semantic-info/10', border: 'border-semantic-info/30', text: 'text-semantic-info', accent: 'bg-semantic-info' },
    drawing: { bg: 'bg-ink/10', border: 'border-ink/30', text: 'text-ink', accent: 'bg-ink' },
    furniture: { bg: 'bg-copper/10', border: 'border-copper/30', text: 'text-copper', accent: 'bg-copper' },
    metalwork: { bg: 'bg-archive/10', border: 'border-archive/30', text: 'text-archive', accent: 'bg-archive' },
    glass: { bg: 'bg-semantic-info/10', border: 'border-semantic-info/30', text: 'text-semantic-info', accent: 'bg-semantic-info' },
  };

  const normalizedType = objectType?.toLowerCase() || '';
  return typeColors[normalizedType] || { bg: 'bg-stone/50', border: 'border-lichen', text: 'text-archive', accent: 'bg-archive' };
}
