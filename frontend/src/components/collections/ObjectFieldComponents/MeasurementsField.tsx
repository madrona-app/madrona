import { Plus, X, AlertCircle } from 'lucide-react';
import type { Measurement } from './types';

const inputClass = 'px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark';
const inputErrorClass = 'px-3 py-2 border border-semantic-error/50 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-error/30 focus-visible:ring-offset-2 focus-visible:border-semantic-error';

export function MeasurementsField({
  measurements,
  isEditing,
  onChange,
  onAdd,
  onSave,
}: {
  measurements: Measurement[];
  isEditing: boolean;
  onChange: (measurements: Measurement[]) => void;
  onAdd: () => void;
  onSave: () => void;
}) {
  if (!isEditing) {
    if (measurements.length === 0) return null;
    return (
      <div>
        <dt className="text-sm font-medium text-archive mb-1">Measurements</dt>
        <dd className="text-ink">
          {measurements.map((m, i) => (
            <span key={i}>
              {i > 0 && ' \u00d7 '}
              {m.dimension}: {m.value} {m.unit}
              {m.part && <span className="text-archive"> ({m.part})</span>}
            </span>
          ))}
        </dd>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-ink">Measurements</label>
        <button type="button" onClick={onAdd} className="text-sm text-bark hover:text-copper-dark flex items-center gap-1">
          <Plus size={14} />
          Add measurement
        </button>
      </div>
      <div className="space-y-2">
        {measurements.map((m, i) => {
          const missingDimension = !m.dimension;
          return (
            <div key={i}>
              <div className="flex items-center gap-2">
                <select
                  value={m.dimension}
                  onChange={(e) => {
                    const updated = [...measurements];
                    updated[i] = { ...updated[i], dimension: e.target.value };
                    onChange(updated);
                    onSave();
                  }}
                  className={`w-28 ${missingDimension ? inputErrorClass : inputClass}`}
                >
                  <option value="">Dimension</option>
                  <option value="Height">Height</option>
                  <option value="Width">Width</option>
                  <option value="Depth">Depth</option>
                  <option value="Diameter">Diameter</option>
                  <option value="Weight">Weight</option>
                  <option value="Length">Length</option>
                </select>
                <input
                  type="number"
                  step="0.1"
                  value={m.value ?? ''}
                  onChange={(e) => {
                    const updated = [...measurements];
                    updated[i] = { ...updated[i], value: parseFloat(e.target.value) || 0 };
                    onChange(updated);
                    onSave();
                  }}
                  placeholder="Value"
                  className={`w-24 ${inputClass}`}
                />
                <select
                  value={m.unit}
                  onChange={(e) => {
                    const updated = [...measurements];
                    updated[i] = { ...updated[i], unit: e.target.value };
                    onChange(updated);
                    onSave();
                  }}
                  className={`w-20 ${inputClass}`}
                >
                  <option value="cm">cm</option>
                  <option value="in">in</option>
                  <option value="mm">mm</option>
                  <option value="m">m</option>
                  <option value="kg">kg</option>
                  <option value="g">g</option>
                  <option value="lb">lb</option>
                  <option value="oz">oz</option>
                </select>
                <button
                  type="button"
                  onClick={() => {
                    onChange(measurements.filter((_, idx) => idx !== i));
                    onSave();
                  }}
                  className="p-1 text-archive hover:text-semantic-error"
                >
                  <X size={16} />
                </button>
              </div>
              {missingDimension && (
                <p className="flex items-center gap-1 text-xs text-semantic-error mt-1 ml-1">
                  <AlertCircle size={12} />
                  Select a dimension to save this measurement
                </p>
              )}
            </div>
          );
        })}
        {measurements.length === 0 && (
          <p className="text-sm text-archive italic">No measurements added</p>
        )}
      </div>
    </div>
  );
}
