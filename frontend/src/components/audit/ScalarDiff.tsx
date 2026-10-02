import type { JsonValue } from '../../types/api';
import { formatScalarValue, isEmptyValue, formatEnumValue } from './diffUtils';

interface ScalarDiffProps {
  oldValue: JsonValue;
  newValue: JsonValue;
  fieldName?: string;
  maxLength?: number;
}

function displayValue(val: JsonValue, fieldName?: string, maxLength = 80): string {
  if (fieldName && typeof val === 'string') {
    const enumLabel = formatEnumValue(fieldName, val);
    if (enumLabel !== val) return enumLabel;
  }
  return formatScalarValue(val, maxLength);
}

export function ScalarDiff({ oldValue, newValue, fieldName, maxLength = 80 }: ScalarDiffProps) {
  const oldEmpty = isEmptyValue(oldValue);
  const newEmpty = isEmptyValue(newValue);

  const oldDisplay = oldEmpty ? null : displayValue(oldValue, fieldName, maxLength);
  const newDisplay = newEmpty ? null : displayValue(newValue, fieldName, maxLength);

  return (
    <span className="text-sm inline-flex items-baseline gap-1.5 flex-wrap">
      {oldDisplay !== null ? (
        <span className="text-archive">{oldDisplay}</span>
      ) : (
        <span className="text-archive italic">(empty)</span>
      )}
      <span className="text-archive/60">&rarr;</span>
      {newDisplay !== null ? (
        <span className="text-ink">{newDisplay}</span>
      ) : (
        <span className="text-archive italic">(cleared)</span>
      )}
    </span>
  );
}
