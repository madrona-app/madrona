import type { JsonValue } from '../../types/api';
import { formatEnumValue, formatScalarValue, isEmptyValue } from './diffUtils';
import { formatFieldName } from './formatFieldName';

/**
 * Plain-language sentences for audit events about a child row of a record
 * (an object's measurement, title, other number, inscription, media link or
 * flag; a bib record's holding or item; a visit's object, and so on).
 *
 * The backend records these as link_added / link_removed / link_updated
 * events on the parent with child_entity_type + child_display_key. Each
 * field diff becomes one sentence, e.g.
 *   "Measurement height changed from 10 cm to 12 cm."
 * so the history reads the same to a screen reader as it looks on screen,
 * with no reliance on colour or arrows.
 */

export const CHILD_ENTITY_LABELS: Record<string, string> = {
  object_title: 'Title',
  object_other_number: 'Other number',
  object_measurement: 'Measurement',
  object_inscription: 'Inscription',
  collection_object_media: 'Media',
  object_flag: 'Flag',
  object_classification: 'Classification',
  bib_holding: 'Holding',
  bib_item: 'Item',
  research_visit_object: 'Object',
  insurance_coverage: 'Coverage',
  indemnity_object: 'Indemnified object',
};

/** Child rows named by a term or title: always quoted ("Classification “Textiles”"). */
const QUOTED_TYPES = new Set(['object_classification']);

export interface ChildRowEvent {
  change_type: string;
  child_entity_type?: string | null;
  child_display_key?: string | null;
  field_diffs?: Array<{ field_name: string; old_value: JsonValue; new_value: JsonValue }>;
}

const MAX_DISPLAY = 60;

function valueText(value: JsonValue, fieldName: string): string {
  if (isEmptyValue(value)) return 'empty';
  if (typeof value === 'string') {
    const label = formatEnumValue(fieldName, value);
    if (label !== value) return label;
    // Stored codes such as "on_loan" read as words.
    if (/^[a-z]+(_[a-z]+)+$/.test(value)) return value.replace(/_/g, ' ');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return formatScalarValue(value, 120);
}

/** "Measurement height" / "Title “Slate and stylus”" / "Flag". */
export function childRowName(event: ChildRowEvent): string | null {
  const type = event.child_entity_type;
  if (!type) return null;
  const label = CHILD_ENTITY_LABELS[type] ?? formatFieldName(type);
  const display = (event.child_display_key || '').trim();
  if (!display) return label;
  const shown = display.length > MAX_DISPLAY ? `${display.slice(0, MAX_DISPLAY)}…` : display;
  // Short single-word keys read naturally unquoted ("Measurement height");
  // free text is quoted so its boundaries are clear.
  return QUOTED_TYPES.has(type) || /\s/.test(shown) ? `${label} “${shown}”` : `${label} ${shown}`;
}

/** One sentence per changed field; empty when the event is not about a child row. */
export function childRowSentences(event: ChildRowEvent): string[] {
  const name = childRowName(event);
  if (!name || !event.child_entity_type) return [];
  const label = (CHILD_ENTITY_LABELS[event.child_entity_type] ?? '').toLowerCase();
  const diffs = event.field_diffs ?? [];
  const sentences: string[] = [];

  for (const d of diffs) {
    const field = formatFieldName(d.field_name);
    // A diff named after the row kind (the "measurement" value with its unit,
    // the linked "flag" name) describes the row itself.
    const isSelf = d.field_name.replace(/_/g, ' ').toLowerCase() === label;
    const subject = isSelf ? name : `${name}: ${field}`;
    // A value that is the row's own name is already said ("Added measurement height").
    const repeatsName = (v: JsonValue) => typeof v === 'string' && v === event.child_display_key;
    if (event.change_type === 'link_updated') {
      sentences.push(
        `${subject} changed from ${valueText(d.old_value, d.field_name)} to ${valueText(d.new_value, d.field_name)}.`,
      );
    } else if (event.change_type === 'link_added') {
      if (isEmptyValue(d.new_value) || repeatsName(d.new_value)) continue;
      sentences.push(isSelf ? `${name} set to ${valueText(d.new_value, d.field_name)}.` : `${field}: ${valueText(d.new_value, d.field_name)}.`);
    } else if (event.change_type === 'link_removed') {
      if (isEmptyValue(d.old_value) || repeatsName(d.old_value)) continue;
      sentences.push(isSelf ? `${name} was ${valueText(d.old_value, d.field_name)}.` : `${field} was ${valueText(d.old_value, d.field_name)}.`);
    }
  }
  return sentences;
}

/** Heading line for a child-row event: "Added measurement height", "Removed flag “Needs review”". */
export function childRowHeadline(event: ChildRowEvent): string | null {
  const name = childRowName(event);
  if (!name) return null;
  const lower = name.charAt(0).toLowerCase() + name.slice(1);
  switch (event.change_type) {
    case 'link_added':
      return `Added ${lower}`;
    case 'link_removed':
      return `Removed ${lower}`;
    case 'link_updated':
      return `Changed ${lower}`;
    default:
      return null;
  }
}
