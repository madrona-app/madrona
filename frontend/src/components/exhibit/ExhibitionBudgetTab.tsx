import { useState, useEffect, useCallback, useRef, type KeyboardEvent } from 'react';
import {
  Plus,
  Trash2,
  Download,
  ChevronDown,
  ChevronRight,
  Loader2,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  Save,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { formatCurrency } from '../../lib/formatters';
import ConfirmDialog from '../ConfirmDialog';
import { logger } from '../../lib/logger';
import { MadronaLoader } from '../ui/MadronaLoader';

// === Types ===
type BudgetCategory =
  | 'shipping'
  | 'insurance'
  | 'fabrication'
  | 'printing'
  | 'travel'
  | 'installation'
  | 'mounts'
  | 'conservation'
  | 'rights'
  | 'marketing'
  | 'other';

interface BudgetLine {
  line_id: string;
  category: BudgetCategory;
  category_label: string;
  description: string;
  estimated_amount: number;
  actual_amount: number | null;
  vendor: string | null;
  notes: string | null;
  sort_order: number;
  currency_code: string;
  _isNew?: boolean;
  _isDirty?: boolean;
}

interface BudgetTotals {
  total_estimated: number;
  total_actual: number;
  total_variance: number;
  line_count: number;
  by_category: Array<{
    category: string;
    category_label: string;
    estimated: number;
    actual: number;
    variance: number;
    count: number;
  }>;
}

interface CategoryGroup {
  category: string;
  category_label: string;
  lines: BudgetLine[];
  totals?: {
    estimated: number;
    actual: number;
    variance: number;
    count: number;
  };
}

interface Props {
  organizationId: string;
  exhibitionId: string;
  isEditing: boolean;
}

// === Constants ===
const CATEGORY_OPTIONS: Array<{ value: BudgetCategory; label: string }> = [
  { value: 'shipping', label: 'Shipping' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'fabrication', label: 'Fabrication' },
  { value: 'printing', label: 'Printing' },
  { value: 'travel', label: 'Travel' },
  { value: 'installation', label: 'Installation' },
  { value: 'mounts', label: 'Mounts & Frames' },
  { value: 'conservation', label: 'Conservation' },
  { value: 'rights', label: 'Rights & Licensing' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'other', label: 'Other' },
];

const parseAmount = (value: string): number => {
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
};

// === Component ===
export function ExhibitionBudgetTab({ organizationId, exhibitionId, isEditing }: Props) {
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [totals, setTotals] = useState<BudgetTotals | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [pendingChanges, setPendingChanges] = useState<Map<string, Partial<BudgetLine>>>(new Map());
  const [newLines, setNewLines] = useState<BudgetLine[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<{ lineId: string; description: string } | null>(null);

  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Load budget data
  const loadBudget = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch<{
        groups: CategoryGroup[];
        totals: BudgetTotals;
        currency_code: string;
      }>(
        `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/budget?group_by=category`
      );
      setGroups(data.groups || []);
      setTotals(data.totals);
      setCurrency(data.currency_code || 'USD');
    } catch (err) {
      logger.error('Failed to load budget:', err);
      setError(err instanceof Error ? err.message : 'Failed to load budget');
    } finally {
      setLoading(false);
    }
  }, [organizationId, exhibitionId]);

  useEffect(() => {
    loadBudget();
  }, [loadBudget]);

  // Toggle category collapse
  const toggleCategory = (category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // Track changes for a line
  const updateLineField = (lineId: string, field: keyof BudgetLine, value: unknown) => {
    setPendingChanges((prev) => {
      const next = new Map(prev);
      const existing = next.get(lineId) || {};
      next.set(lineId, { ...existing, [field]: value });
      return next;
    });

    // Update local state for immediate feedback
    if (lineId.startsWith('new-')) {
      setNewLines((prev) =>
        prev.map((line) =>
          line.line_id === lineId ? { ...line, [field]: value, _isDirty: true } : line
        )
      );
    } else {
      setGroups((prev) =>
        prev.map((group) => ({
          ...group,
          lines: group.lines.map((line) =>
            line.line_id === lineId ? { ...line, [field]: value, _isDirty: true } : line
          ),
        }))
      );
    }
  };

  // Add new line
  const addNewLine = (category: BudgetCategory = 'other') => {
    const newLine: BudgetLine = {
      line_id: `new-${Date.now()}`,
      category,
      category_label: CATEGORY_OPTIONS.find((c) => c.value === category)?.label || category,
      description: '',
      estimated_amount: 0,
      actual_amount: null,
      vendor: null,
      notes: null,
      sort_order: 0,
      currency_code: currency,
      _isNew: true,
      _isDirty: true,
    };
    setNewLines((prev) => [...prev, newLine]);

    // Ensure category is expanded
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      next.delete(category);
      return next;
    });

    // Focus the description input after render
    setTimeout(() => {
      const input = inputRefs.current.get(`${newLine.line_id}-description`);
      if (input) input.focus();
    }, 50);
  };

  // Save all changes
  const saveChanges = async () => {
    if (pendingChanges.size === 0 && newLines.length === 0) return;

    try {
      setSaving(true);
      setError(null);

      const operations: Array<{ op: string; data: Record<string, unknown> }> = [];

      // Add creates for new lines
      for (const line of newLines) {
        if (line.description.trim()) {
          operations.push({
            op: 'create',
            data: {
              category: line.category,
              description: line.description,
              estimated_amount: line.estimated_amount,
              actual_amount: line.actual_amount,
              vendor: line.vendor,
              notes: line.notes,
              currency_code: line.currency_code,
            },
          });
        }
      }

      // Add updates for changed lines
      for (const [lineId, changes] of pendingChanges.entries()) {
        if (!lineId.startsWith('new-')) {
          operations.push({
            op: 'update',
            data: { line_id: lineId, ...changes },
          });
        }
      }

      if (operations.length > 0) {
        const result = await apiFetch<{ totals: BudgetTotals }>(
          `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/budget/bulk`,
          {
            method: 'POST',
            body: JSON.stringify({ operations }),
          }
        );
        setTotals(result.totals);
      }

      // Clear pending state and reload
      setPendingChanges(new Map());
      setNewLines([]);
      await loadBudget();
    } catch (err) {
      logger.error('Failed to save budget:', err);
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  // Delete line
  const deleteLine = async (lineId: string) => {
    if (lineId.startsWith('new-')) {
      setNewLines((prev) => prev.filter((l) => l.line_id !== lineId));
      setPendingChanges((prev) => {
        const next = new Map(prev);
        next.delete(lineId);
        return next;
      });
      return;
    }

    try {
      setSaving(true);
      await apiFetch(
        `/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/budget/${lineId}`,
        { method: 'DELETE' }
      );
      setPendingChanges((prev) => {
        const next = new Map(prev);
        next.delete(lineId);
        return next;
      });
      await loadBudget();
    } catch (err) {
      logger.error('Failed to delete line:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete line');
    } finally {
      setSaving(false);
    }
  };

  // Export CSV
  const exportCSV = async () => {
    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/exhibit/exhibitions/${exhibitionId}/budget/export`,
        { credentials: 'include' }
      );
      if (!response.ok) throw new Error('Export failed');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `budget-export-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      logger.error('Failed to export:', err);
      setError('Failed to export budget');
    }
  };

  // Keyboard navigation
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>, _lineId: string, _field: string) => {
    if (e.key === 'Tab' || e.key === 'Enter') {
      // Natural tab order handles this
      return;
    }
    if (e.key === 'Escape') {
      (e.target as HTMLInputElement).blur();
    }
  };

  // Check if there are unsaved changes
  const hasUnsavedChanges = pendingChanges.size > 0 || newLines.some((l) => l.description.trim());

  // Combine groups with new lines
  const allGroups = [...groups];
  for (const newLine of newLines) {
    const existingGroup = allGroups.find((g) => g.category === newLine.category);
    if (existingGroup) {
      existingGroup.lines = [...existingGroup.lines, newLine];
    } else {
      allGroups.push({
        category: newLine.category,
        category_label: newLine.category_label,
        lines: [newLine],
      });
    }
  }

  // Sort groups by category order
  const categoryOrder = CATEGORY_OPTIONS.map((c) => c.value);
  allGroups.sort((a, b) => categoryOrder.indexOf(a.category as BudgetCategory) - categoryOrder.indexOf(b.category as BudgetCategory));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <MadronaLoader variant="dots" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-ink">Exhibition Budget</h2>
          <p className="text-sm text-ink/60 mt-1">Track estimated and actual costs by category</p>
        </div>
        <div className="flex items-center gap-2">
          {hasUnsavedChanges && (
            <button
              onClick={saveChanges}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Changes
            </button>
          )}
          <button
            onClick={exportCSV}
            className="flex items-center gap-2 px-3 py-2 text-ink/70 hover:text-ink border border-lichen rounded-lg hover:bg-stone/50 transition-colors"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
          {isEditing && (
            <button
              onClick={() => addNewLine()}
              className="flex items-center gap-2 px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Line
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-semantic-error text-sm">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      {totals && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-parchment/50 rounded-lg p-4">
            <div className="text-sm text-ink/60 mb-1">Estimated Total</div>
            <div className="text-2xl font-semibold text-ink">
              {formatCurrency(totals.total_estimated, currency)}
            </div>
          </div>
          <div className="bg-parchment/50 rounded-lg p-4">
            <div className="text-sm text-ink/60 mb-1">Actual Total</div>
            <div className="text-2xl font-semibold text-ink">
              {formatCurrency(totals.total_actual, currency)}
            </div>
          </div>
          <div
            className={`rounded-lg p-4 ${
              totals.total_variance > 0
                ? 'bg-semantic-error/10'
                : totals.total_variance < 0
                ? 'bg-semantic-success/10'
                : 'bg-parchment/50'
            }`}
          >
            <div className="text-sm text-ink/60 mb-1">Variance</div>
            <div
              className={`text-2xl font-semibold flex items-center gap-2 ${
                totals.total_variance > 0
                  ? 'text-semantic-error'
                  : totals.total_variance < 0
                  ? 'text-semantic-success'
                  : 'text-ink'
              }`}
            >
              {totals.total_variance > 0 && <AlertTriangle className="w-5 h-5" />}
              {totals.total_variance < 0 && <CheckCircle2 className="w-5 h-5" />}
              {formatCurrency(totals.total_variance, currency)}
            </div>
          </div>
          <div className="bg-parchment/50 rounded-lg p-4">
            <div className="text-sm text-ink/60 mb-1">Line Items</div>
            <div className="text-2xl font-semibold text-ink">{totals.line_count}</div>
          </div>
        </div>
      )}

      {/* Budget Grid */}
      <div className="bg-parchment border border-lichen rounded-lg overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-[1fr_2fr_140px_140px_140px_1fr_48px] gap-2 px-4 py-3 bg-stone/30 border-b border-lichen text-sm font-medium text-ink/70">
          <div>Category</div>
          <div>Description</div>
          <div className="text-right">Estimated</div>
          <div className="text-right">Actual</div>
          <div className="text-right">Variance</div>
          <div>Vendor</div>
          <div></div>
        </div>

        {/* Category Groups */}
        {allGroups.length === 0 ? (
          <div className="text-center py-12 text-ink/50">
            <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No budget items yet</p>
            {isEditing && (
              <button
                onClick={() => addNewLine()}
                className="mt-4 text-bark hover:text-copper-dark transition-colors"
              >
                Add your first budget line
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-lichen">
            {allGroups.map((group) => {
              const isCollapsed = collapsedCategories.has(group.category);
              const groupTotals = group.totals || totals?.by_category.find((c) => c.category === group.category);

              return (
                <div key={group.category}>
                  {/* Category Header */}
                  <button
                    onClick={() => toggleCategory(group.category)}
                    className="w-full grid grid-cols-[1fr_2fr_140px_140px_140px_1fr_48px] gap-2 px-4 py-2 bg-stone/20 hover:bg-stone/40 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2 font-medium text-ink">
                      {isCollapsed ? (
                        <ChevronRight className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                      {group.category_label}
                      <span className="text-xs text-ink/50">({group.lines.length})</span>
                    </div>
                    <div></div>
                    <div className="text-right text-sm text-ink/70">
                      {groupTotals && formatCurrency(groupTotals.estimated, currency)}
                    </div>
                    <div className="text-right text-sm text-ink/70">
                      {groupTotals && formatCurrency(groupTotals.actual, currency)}
                    </div>
                    <div
                      className={`text-right text-sm ${
                        groupTotals && groupTotals.variance > 0
                          ? 'text-semantic-error'
                          : groupTotals && groupTotals.variance < 0
                          ? 'text-semantic-success'
                          : 'text-ink/70'
                      }`}
                    >
                      {groupTotals && formatCurrency(groupTotals.variance, currency)}
                    </div>
                    <div></div>
                    <div></div>
                  </button>

                  {/* Lines */}
                  {!isCollapsed && (
                    <div className="divide-y divide-lichen/50">
                      {group.lines.map((line) => {
                        const variance =
                          line.actual_amount !== null
                            ? line.actual_amount - line.estimated_amount
                            : null;

                        return (
                          <div
                            key={line.line_id}
                            className={`grid grid-cols-[1fr_2fr_140px_140px_140px_1fr_48px] gap-2 px-4 py-2 items-center ${
                              line._isDirty ? 'bg-semantic-warning/10' : 'hover:bg-stone'
                            }`}
                          >
                            {/* Category (for new lines) */}
                            <div className="pl-6">
                              {line._isNew && isEditing ? (
                                <select
                                  value={line.category}
                                  onChange={(e) =>
                                    updateLineField(line.line_id, 'category', e.target.value)
                                  }
                                  className="w-full text-sm border border-lichen rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                                >
                                  {CATEGORY_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="text-sm text-ink/50">{line.category_label}</span>
                              )}
                            </div>

                            {/* Description */}
                            <div>
                              {isEditing ? (
                                <input
                                  ref={(el) => {
                                    if (el) inputRefs.current.set(`${line.line_id}-description`, el);
                                  }}
                                  type="text"
                                  value={line.description}
                                  onChange={(e) =>
                                    updateLineField(line.line_id, 'description', e.target.value)
                                  }
                                  onKeyDown={(e) => handleKeyDown(e, line.line_id, 'description')}
                                  placeholder="Enter description..."
                                  className="w-full text-sm border border-lichen rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                                />
                              ) : (
                                <span className="text-sm text-ink">{line.description}</span>
                              )}
                            </div>

                            {/* Estimated */}
                            <div className="text-right">
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={line.estimated_amount || ''}
                                  onChange={(e) =>
                                    updateLineField(
                                      line.line_id,
                                      'estimated_amount',
                                      parseAmount(e.target.value)
                                    )
                                  }
                                  onKeyDown={(e) => handleKeyDown(e, line.line_id, 'estimated')}
                                  placeholder="0.00"
                                  className="w-full text-sm text-right border border-lichen rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                                />
                              ) : (
                                <span className="text-sm text-ink">
                                  {formatCurrency(line.estimated_amount, currency)}
                                </span>
                              )}
                            </div>

                            {/* Actual */}
                            <div className="text-right">
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={line.actual_amount ?? ''}
                                  onChange={(e) =>
                                    updateLineField(
                                      line.line_id,
                                      'actual_amount',
                                      e.target.value ? parseAmount(e.target.value) : null
                                    )
                                  }
                                  onKeyDown={(e) => handleKeyDown(e, line.line_id, 'actual')}
                                  placeholder="—"
                                  className="w-full text-sm text-right border border-lichen rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                                />
                              ) : (
                                <span className="text-sm text-ink">
                                  {formatCurrency(line.actual_amount, currency)}
                                </span>
                              )}
                            </div>

                            {/* Variance */}
                            <div className="text-right">
                              <span
                                className={`text-sm ${
                                  variance !== null && variance > 0
                                    ? 'text-semantic-error'
                                    : variance !== null && variance < 0
                                    ? 'text-semantic-success'
                                    : 'text-ink/50'
                                }`}
                              >
                                {variance !== null ? formatCurrency(variance, currency) : '—'}
                              </span>
                            </div>

                            {/* Vendor */}
                            <div>
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={line.vendor || ''}
                                  onChange={(e) =>
                                    updateLineField(
                                      line.line_id,
                                      'vendor',
                                      e.target.value || null
                                    )
                                  }
                                  onKeyDown={(e) => handleKeyDown(e, line.line_id, 'vendor')}
                                  placeholder="Vendor..."
                                  className="w-full text-sm border border-lichen rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                                />
                              ) : (
                                <span className="text-sm text-ink/70">{line.vendor || '—'}</span>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex justify-end">
                              {isEditing && (
                                <button
                                  onClick={() =>
                                    setDeleteConfirm({
                                      lineId: line.line_id,
                                      description: line.description || 'this line',
                                    })
                                  }
                                  className="p-1 text-ink/40 hover:text-semantic-error transition-colors"
                                  title="Delete line"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* Add line in category */}
                      {isEditing && (
                        <button
                          onClick={() => addNewLine(group.category as BudgetCategory)}
                          className="w-full px-4 py-2 pl-10 text-left text-sm text-bark hover:bg-bark/5 transition-colors flex items-center gap-2"
                        >
                          <Plus className="w-4 h-4" />
                          Add {group.category_label.toLowerCase()} item
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Totals Row */}
        {totals && totals.line_count > 0 && (
          <div className="grid grid-cols-[1fr_2fr_140px_140px_140px_1fr_48px] gap-2 px-4 py-3 bg-bark/5 border-t border-lichen font-medium">
            <div className="text-ink">Total</div>
            <div></div>
            <div className="text-right text-ink">
              {formatCurrency(totals.total_estimated, currency)}
            </div>
            <div className="text-right text-ink">
              {formatCurrency(totals.total_actual, currency)}
            </div>
            <div
              className={`text-right ${
                totals.total_variance > 0
                  ? 'text-semantic-error'
                  : totals.total_variance < 0
                  ? 'text-semantic-success'
                  : 'text-ink'
              }`}
            >
              {formatCurrency(totals.total_variance, currency)}
            </div>
            <div></div>
            <div></div>
          </div>
        )}
      </div>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm) {
            deleteLine(deleteConfirm.lineId);
            setDeleteConfirm(null);
          }
        }}
        title="Delete Budget Line"
        message={`Are you sure you want to delete "${deleteConfirm?.description}"?`}
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}
