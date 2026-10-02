/**
 * Advanced Search Builder Component
 *
 * A visual query builder for constructing complex search criteria.
 * Allows users to build multi-field searches with different operators.
 */

import { useState, useCallback } from 'react';
import { Plus, X, ChevronDown, ChevronUp } from 'lucide-react';
import type {
  AdvancedCriterion,
  AdvancedSearchField,
  AdvancedSearchOperator,
} from '../lib/api';

interface AdvancedSearchBuilderProps {
  criteria: AdvancedCriterion[];
  operator: 'and' | 'or';
  onChange: (criteria: AdvancedCriterion[], operator: 'and' | 'or') => void;
}

interface FieldOptionGroup {
  label: string;
  options: { value: AdvancedSearchField; label: string }[];
}

const FIELD_GROUPS: FieldOptionGroup[] = [
  {
    label: 'General',
    options: [
      { value: 'any', label: 'Any Field' },
    ],
  },
  {
    label: 'Identification',
    options: [
      { value: 'title', label: 'Title' },
      { value: 'object_number', label: 'Object Number' },
      { value: 'object_name', label: 'Object Name' },
      { value: 'classification', label: 'Classification' },
    ],
  },
  {
    label: 'Description & Physical',
    options: [
      { value: 'description', label: 'Description' },
      { value: 'material', label: 'Material' },
      { value: 'technique', label: 'Technique' },
      { value: 'inscription', label: 'Inscription' },
    ],
  },
  {
    label: 'Production & History',
    options: [
      { value: 'creator', label: 'Creator / Maker' },
      { value: 'place', label: 'Place of Creation' },
      { value: 'subject', label: 'Subject' },
      { value: 'provenance', label: 'Provenance' },
      { value: 'credit_line', label: 'Credit Line' },
    ],
  },
];

const OPERATOR_OPTIONS: { value: AdvancedSearchOperator; label: string }[] = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: 'equals' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'not_contains', label: 'does not contain' },
];

export default function AdvancedSearchBuilder({
  criteria,
  operator,
  onChange,
}: AdvancedSearchBuilderProps) {
  const [isExpanded, setIsExpanded] = useState(criteria.length > 0);

  const addCriterion = useCallback(() => {
    const newCriterion: AdvancedCriterion = {
      field: 'any',
      operator: 'contains',
      value: '',
    };
    onChange([...criteria, newCriterion], operator);
    setIsExpanded(true);
  }, [criteria, operator, onChange]);

  const removeCriterion = useCallback(
    (index: number) => {
      const newCriteria = criteria.filter((_, i) => i !== index);
      onChange(newCriteria, operator);
    },
    [criteria, operator, onChange]
  );

  const updateCriterion = useCallback(
    (index: number, updates: Partial<AdvancedCriterion>) => {
      const newCriteria = criteria.map((c, i) =>
        i === index ? { ...c, ...updates } : c
      );
      onChange(newCriteria, operator);
    },
    [criteria, operator, onChange]
  );

  const toggleOperator = useCallback(() => {
    onChange(criteria, operator === 'and' ? 'or' : 'and');
  }, [criteria, operator, onChange]);

  const clearAll = useCallback(() => {
    onChange([], 'and');
  }, [onChange]);

  return (
    <div className="border border-lichen rounded-lg bg-stone">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-controls="advanced-search-content"
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-ink hover:bg-stone rounded-t-lg"
      >
        <span className="flex items-center gap-2">
          Advanced Search
          {criteria.length > 0 && (
            <span className="bg-stone-600 text-parchment text-xs px-2 py-0.5 rounded-full">
              {criteria.length} {criteria.length === 1 ? 'criterion' : 'criteria'}
            </span>
          )}
        </span>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4" aria-hidden="true" />
        ) : (
          <ChevronDown className="w-4 h-4" aria-hidden="true" />
        )}
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div id="advanced-search-content" className="px-4 pb-4 space-y-3">
          {/* Criteria List */}
          {criteria.map((criterion, index) => (
            <div key={index} className="flex items-center gap-2">
              {/* Boolean operator between rows */}
              {index > 0 && (
                <button
                  onClick={toggleOperator}
                  className="px-2 py-1 text-xs font-medium rounded bg-stone-200 text-stone-700 hover:bg-stone-300 min-w-[40px]"
                >
                  {operator.toUpperCase()}
                </button>
              )}
              {index === 0 && <div className="min-w-[40px]" />}

              {/* Field selector */}
              <select
                value={criterion.field}
                onChange={(e) =>
                  updateCriterion(index, {
                    field: e.target.value as AdvancedSearchField,
                  })
                }
                aria-label="Search field"
                className="px-3 py-2 border border-lichen rounded-md text-sm focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-stone-500"
              >
                {FIELD_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>

              {/* Operator selector */}
              <select
                value={criterion.operator}
                onChange={(e) =>
                  updateCriterion(index, {
                    operator: e.target.value as AdvancedSearchOperator,
                  })
                }
                aria-label="Search operator"
                className="px-3 py-2 border border-lichen rounded-md text-sm focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-stone-500"
              >
                {OPERATOR_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              {/* Value input */}
              <input
                type="text"
                value={criterion.value}
                onChange={(e) => updateCriterion(index, { value: e.target.value })}
                placeholder="Enter search value..."
                aria-label="Search value"
                className="flex-1 px-3 py-2 border border-lichen rounded-md text-sm focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-stone-500"
              />

              {/* Remove button */}
              <button
                onClick={() => removeCriterion(index)}
                className="p-2 text-archive hover:text-semantic-error"
                aria-label="Remove criterion"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          ))}

          {/* Add/Clear buttons */}
          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={addCriterion}
              className="flex items-center gap-1 px-3 py-2 text-sm text-stone-600 hover:text-stone-800 hover:bg-stone-100 rounded-md"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Add criterion
            </button>
            {criteria.length > 0 && (
              <button
                onClick={clearAll}
                className="px-3 py-2 text-sm text-archive hover:text-ink"
              >
                Clear all
              </button>
            )}
          </div>

          {/* Help text */}
          {criteria.length === 0 && (
            <p className="text-xs text-archive pt-1">
              Add criteria to search specific fields with different operators.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
