/**
 * Centralized locale-aware formatting utilities.
 *
 * Every function accepts an optional `locale` parameter that defaults to
 * the browser's language so dates, numbers, and currencies automatically
 * adapt to the user's region (e.g. DD/MM/YYYY in the UK, comma decimals
 * in France).
 */

// ---------------------------------------------------------------------------
// Locale helper
// ---------------------------------------------------------------------------

function browserLocale(): string {
  return typeof navigator !== 'undefined' ? navigator.language : 'en-US';
}

// ---------------------------------------------------------------------------
// Date formatters
// ---------------------------------------------------------------------------

/** "Mar 28, 2026" — or locale equivalent */
export function formatDateShort(
  value: string | Date | null | undefined,
  locale?: string,
): string {
  if (!value) return '\u2014';
  try {
    const d = value instanceof Date ? value : new Date(value);
    return d.toLocaleDateString(locale ?? browserLocale(), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return String(value);
  }
}

/** "March 28, 2026" — or locale equivalent */
export function formatDateLong(
  value: string | Date | null | undefined,
  locale?: string,
): string {
  if (!value) return '\u2014';
  try {
    const d = value instanceof Date ? value : new Date(value);
    return d.toLocaleDateString(locale ?? browserLocale(), {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return String(value);
  }
}

/** "Mar 2026" — or locale equivalent */
export function formatDateMonth(
  value: string | Date | null | undefined,
  locale?: string,
): string {
  if (!value) return '\u2014';
  try {
    const d = value instanceof Date ? value : new Date(value);
    return d.toLocaleDateString(locale ?? browserLocale(), {
      year: 'numeric',
      month: 'short',
    });
  } catch {
    return String(value);
  }
}

/** "Mar 28, 2026, 2:30 PM" — or locale equivalent */
export function formatDateTime(
  value: string | Date | null | undefined,
  locale?: string,
): string {
  if (!value) return '\u2014';
  try {
    const d = value instanceof Date ? value : new Date(value);
    return d.toLocaleString(locale ?? browserLocale(), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return String(value);
  }
}

/** "2:30 PM" — or locale equivalent */
export function formatTime(
  value: string | Date | null | undefined,
  locale?: string,
): string {
  if (!value) return '\u2014';
  try {
    const d = value instanceof Date ? value : new Date(value);
    return d.toLocaleTimeString(locale ?? browserLocale(), {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Number / currency formatters
// ---------------------------------------------------------------------------

/** "1,234" — or locale equivalent (e.g. "1.234" in DE) */
export function formatNumber(
  value: number | null | undefined,
  locale?: string,
): string {
  if (value == null) return '\u2014';
  return value.toLocaleString(locale ?? browserLocale());
}

/**
 * "$1,234.00" — or locale equivalent.
 *
 * @param currency  ISO 4217 code, defaults to "USD"
 * @param decimals  Fraction digits — defaults to 2
 */
export function formatCurrency(
  value: number | null | undefined,
  currency: string = 'USD',
  decimals: number = 2,
  locale?: string,
): string {
  if (value == null) return '\u2014';
  return new Intl.NumberFormat(locale ?? browserLocale(), {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

// ---------------------------------------------------------------------------
// Relative time
// ---------------------------------------------------------------------------

/** "3 minutes ago", "Just now", or falls back to short date */
export function formatRelativeTime(
  value: string | Date | null | undefined,
  locale?: string,
): string {
  if (!value) return 'Never';

  const d = value instanceof Date ? value : new Date(value);
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);

  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) {
    const m = Math.floor(diffSec / 60);
    return `${m} minute${m !== 1 ? 's' : ''} ago`;
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600);
    return `${h} hour${h !== 1 ? 's' : ''} ago`;
  }
  if (diffSec < 604800) {
    const days = Math.floor(diffSec / 86400);
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  }

  return formatDateShort(d, locale);
}
