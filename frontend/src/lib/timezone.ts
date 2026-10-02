import { logger } from './logger';

/**
 * Timezone utilities for formatting dates based on organization settings.
 *
 * All functions accept an optional `locale` parameter that defaults to
 * the browser's language so output adapts to the user's region.
 */

function browserLocale(): string {
  return typeof navigator !== 'undefined' ? navigator.language : 'en-US';
}

/**
 * Format a date string with timezone awareness.
 *
 * @param dateString - ISO 8601 date string from the API
 * @param timezone - IANA timezone identifier (e.g., "America/New_York")
 * @param options - Intl.DateTimeFormatOptions
 * @param locale - BCP 47 locale tag; defaults to browser language
 * @returns Formatted date string in the specified timezone
 */
export function formatDateWithTimezone(
  dateString: string,
  timezone: string = 'America/New_York',
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  },
  locale?: string,
): string {
  const loc = locale ?? browserLocale();
  try {
    return new Date(dateString).toLocaleString(loc, {
      ...options,
      timeZone: timezone,
    });
  } catch (error) {
    logger.error('Error formatting date with timezone:', error);
    // Fallback to browser's local timezone
    return new Date(dateString).toLocaleString(loc, options);
  }
}

/**
 * Format a date string for short display (without time).
 */
export function formatDateShort(
  dateString: string,
  timezone: string = 'America/New_York',
  locale?: string,
): string {
  return formatDateWithTimezone(dateString, timezone, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }, locale);
}

/**
 * Format a date string for full display with time.
 */
export function formatDateTimeFull(
  dateString: string,
  timezone: string = 'America/New_York',
  locale?: string,
): string {
  return formatDateWithTimezone(dateString, timezone, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }, locale);
}

/**
 * Get timezone abbreviation (e.g., "EST", "PST").
 */
export function getTimezoneAbbreviation(timezone: string = 'America/New_York', locale?: string): string {
  try {
    const formatter = new Intl.DateTimeFormat(locale ?? browserLocale(), {
      timeZone: timezone,
      timeZoneName: 'short',
    });
    const parts = formatter.formatToParts(new Date());
    const timeZonePart = parts.find(part => part.type === 'timeZoneName');
    return timeZonePart?.value || timezone;
  } catch {
    return timezone;
  }
}

/**
 * Format a date with timezone indicator appended (e.g., "Jan 14, 2:30 PM EST").
 */
export function formatDateTimeWithZone(
  dateString: string | null | undefined,
  timezone: string = 'UTC',
  locale?: string,
): string {
  if (!dateString) return '-';
  try {
    return new Date(dateString).toLocaleString(locale ?? browserLocale(), {
      timeZone: timezone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    });
  } catch {
    return dateString;
  }
}

/**
 * Get the current UTC offset for a timezone (e.g., "-05:00").
 */
export function getTimezoneOffset(timezone: string): string {
  try {
    const date = new Date();
    // Use en-US here intentionally — we're parsing the output back into Date
    // objects for arithmetic, so we need a predictable format.
    const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
    const diff = (tzDate.getTime() - utcDate.getTime()) / (1000 * 60);
    const hours = Math.floor(Math.abs(diff) / 60);
    const minutes = Math.abs(diff) % 60;
    const sign = diff >= 0 ? '+' : '-';
    return `UTC${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  } catch {
    return '';
  }
}

/**
 * Get a human-readable timezone display name with offset.
 * e.g., "America/New_York" -> "America/New_York (EST, UTC-05:00)"
 */
export function getTimezoneDisplayName(timezone: string): string {
  const abbrev = getTimezoneAbbreviation(timezone);
  const offset = getTimezoneOffset(timezone);
  if (abbrev !== timezone && offset) {
    return `${timezone} (${abbrev}, ${offset})`;
  }
  if (offset) {
    return `${timezone} (${offset})`;
  }
  return timezone;
}

/**
 * Validate if a string is a valid IANA timezone identifier.
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
