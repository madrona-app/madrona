/**
 * Helper functions for Collection Object field components.
 */

import type { Title } from './types';

/**
 * Get the display title for an object.
 * Returns the preferred title if available, otherwise the first title or object_name.
 */
export function getDisplayTitle(object: { titles?: Title[] | null; object_name?: string | null }): string {
  if (object.titles && object.titles.length > 0) {
    const preferred = object.titles.find((t) => t.is_preferred);
    return preferred?.title || object.titles[0].title;
  }
  return object.object_name || 'Untitled';
}

/**
 * Get the creator display string for an object.
 * Returns the first creator's name with attribution, or null if no creators.
 */
export function getCreatorDisplay(object: { creators?: Array<{ name: string; attribution?: string | null }> | null }): string | null {
  if (!object.creators || object.creators.length === 0) return null;
  const creator = object.creators[0];
  if (creator.attribution) {
    return `${creator.attribution} ${creator.name}`;
  }
  return creator.name;
}

/**
 * Capitalize the first letter of a string.
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Format a dimension measurement for display.
 */
export function formatMeasurement(dimension: string, value: number, unit: string): string {
  return `${capitalize(dimension)}: ${value} ${unit}`;
}
