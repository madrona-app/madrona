/**
 * Objects Section
 *
 * Displays and edits object entry summary, per-item list,
 * storage location, and media.
 */

import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Package,
  MapPin,
  X,
  Upload,
  Plus,
  ChevronDown,
  ChevronRight,
  Trash2,
  ExternalLink,
  Loader2,
  ClipboardCheck,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  WorkspaceSection,
  EditableField,
} from '../../../components/workspace';
import { SectionCompletionBadge } from '../../../components/collections/SectionCompletionBadge';
import { LocationPickerModal } from '../../../components/collections/LocationPickerModal';
import SlideOver from '../../../components/ui/SlideOver';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { cn } from '../../../lib/utils';
import type { ObjectsSectionProps } from './types';
import {
  addObjectEntryItem,
  updateObjectEntryItem,
  removeObjectEntryItem,
  uploadObjectEntryItemMedia,
  removeObjectEntryItemMedia,
  setObjectEntryItemPrimaryMedia,
  type ObjectEntryItemInput,
} from '../../../lib/api/procedure/entries';
import { createConditionReport } from '../../../lib/api';

const inputClass = 'w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark';

interface EntryItem {
  entry_item_id?: string;
  item_number?: number | null;
  brief_description?: string | null;
  detailed_description?: string | null;
  lender_object_number?: string | null;
  object_id?: string | null;
  declared_value?: number | null;
  declared_value_currency?: string | null;
  condition_note?: string | null;
  condition_report_id?: string | null;
  condition_report_number?: string | null;
  location_id?: string | null;
  location_name?: string | null;
  location_path?: string | null;
  item_status?: string | null;
  item_outcome?: string | null;
  item_outcome_note?: string | null;
  media?: Array<{
    media_id: string;
    filename: string;
    media_type: string;
    mime_type: string;
    thumbnail_url?: string | null;
    is_primary?: boolean;
    sort_order?: number;
    caption?: string | null;
    usage_type?: string | null;
  }>;
}

export function ObjectsSection({
  formData,
  updateField,
  isExpanded,
  onToggle,
  isEditing,
  isCreateMode,
  getSectionOrder,
  sectionCompletion,
  orgId,
  entryId: _entryId,
  entry,
  hasMediaApp: _hasMediaApp = true,
}: ObjectsSectionProps) {
  const queryClient = useQueryClient();
  const entryId = entry?.entry_id as string | undefined;

  const items: EntryItem[] = (entry?.items || []) as EntryItem[];

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [showAddSlideOver, setShowAddSlideOver] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  const invalidateEntry = useCallback(() => {
    if (orgId && entryId) {
      queryClient.invalidateQueries({ queryKey: ['object-entry', orgId, entryId] });
      // Right-rail slideshow reads from a separate aggregated query
      queryClient.invalidateQueries({ queryKey: ['object-entry-all-media', orgId, entryId] });
    }
  }, [queryClient, orgId, entryId]);

  const removeMutation = useMutation({
    mutationFn: (itemId: string) => removeObjectEntryItem(orgId!, entryId!, itemId),
    onSuccess: () => invalidateEntry(),
  });

  const toggleItem = useCallback((itemId: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  const canEdit = isEditing && !isCreateMode && !!entryId;

  // Show the item count in the title so it's visible even when the section is
  // collapsed and regardless of whether the completion badge is taking the
  // right-side badge slot.
  const sectionTitle =
    items.length > 0
      ? `Objects (${items.length} ${items.length === 1 ? 'item' : 'items'})`
      : 'Objects';

  return (
    <WorkspaceSection
      id="objects"
      title={sectionTitle}
      icon={<Package size={20} />}
      badge={!isCreateMode && sectionCompletion ? <SectionCompletionBadge completion={sectionCompletion} /> : undefined}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={getSectionOrder('objects')}
    >
      <div className="space-y-6">
        <EditableField
          value={formData.objects_description || ''}
          label="Summary Description"
          isEditing={isEditing}
          onChange={(v) => updateField('objects_description', v)}
          multiline
          rows={3}
          placeholder="Brief summary of the deposit (optional, per-item details below)..."
        />

        {/* Items list */}
        {!isCreateMode && entryId && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-ink">
                Entry Items {items.length > 0 && <span className="text-archive">({items.length})</span>}
              </h4>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setShowAddSlideOver(true)}
                  className="text-sm text-bark hover:text-copper-dark flex items-center gap-1"
                >
                  <Plus size={14} />
                  Add Item
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-lichen rounded-lg">
                <Package size={28} className="mx-auto text-archive mb-2" />
                <p className="text-sm text-archive mb-3">No items added yet</p>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setShowAddSlideOver(true)}
                    className="btn btn-primary text-sm"
                  >
                    <Plus size={14} className="mr-1" />
                    Add First Item
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((item, idx) => {
                  const itemId = item.entry_item_id || `idx-${idx}`;
                  const isItemExpanded = expandedItems.has(itemId);
                  return (
                    <div
                      key={itemId}
                      className={`bg-stone/30 border rounded-lg overflow-hidden transition-colors ${
                        isItemExpanded ? 'border-bark/40' : 'border-stone hover:border-archive'
                      }`}
                    >
                      {/* Header row */}
                      <div className="flex items-center gap-3 px-4 py-3">
                        <button
                          type="button"
                          onClick={() => toggleItem(itemId)}
                          className="p-0.5 text-archive hover:text-ink transition-colors"
                        >
                          {isItemExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                        <span className="text-xs text-archive flex-shrink-0">#{item.item_number ?? idx + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-ink truncate">
                            {item.brief_description || <span className="text-archive italic">No description</span>}
                          </p>
                          {item.lender_object_number && (
                            <p className="text-xs text-archive">Depositor #: {item.lender_object_number}</p>
                          )}
                        </div>
                        {item.declared_value != null && (
                          <span className="hidden sm:inline text-xs text-archive flex-shrink-0">
                            {item.declared_value_currency || 'USD'} {item.declared_value}
                          </span>
                        )}
                        {item.object_id && (
                          <Link
                            to={`/organizations/${orgId}/collections/objects/${item.object_id}`}
                            className="p-1 text-archive hover:text-bark transition-colors"
                            title="View accessioned object"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink size={14} />
                          </Link>
                        )}
                        {canEdit && item.entry_item_id && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setItemToDelete(item.entry_item_id!);
                            }}
                            className="p-1 text-archive hover:text-semantic-error transition-colors"
                            title="Remove item"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>

                      {/* Expanded detail panel */}
                      {isItemExpanded && item.entry_item_id && (
                        <ItemDetailPanel
                          item={item}
                          orgId={orgId}
                          entryId={entryId}
                          canEdit={canEdit}
                          onSaved={invalidateEntry}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Add Item Slide-over */}
      {entryId && (
        <AddItemSlideOver
          isOpen={showAddSlideOver}
          onClose={() => setShowAddSlideOver(false)}
          orgId={orgId!}
          entryId={entryId}
          onSuccess={() => {
            setShowAddSlideOver(false);
            invalidateEntry();
          }}
        />
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={!!itemToDelete}
        onClose={() => setItemToDelete(null)}
        onConfirm={() => {
          if (itemToDelete) {
            removeMutation.mutate(itemToDelete);
            setItemToDelete(null);
          }
        }}
        title="Remove Item"
        message="Remove this item from the entry? This cannot be undone."
        confirmText="Remove"
        confirmStyle="danger"
      />
    </WorkspaceSection>
  );
}

// ============================================================================
// Item Detail Panel (expanded view with editable fields)
// ============================================================================

function ItemDetailPanel({
  item,
  orgId,
  entryId,
  canEdit,
  onSaved,
}: {
  item: EntryItem;
  orgId: string;
  entryId: string;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [showConditionReportSlideOver, setShowConditionReportSlideOver] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [formState, setFormState] = useState({
    brief_description: item.brief_description || '',
    detailed_description: item.detailed_description || '',
    lender_object_number: item.lender_object_number || '',
    declared_value: item.declared_value != null ? String(item.declared_value) : '',
    declared_value_currency: item.declared_value_currency || 'USD',
    condition_note: item.condition_note || '',
    item_outcome_note: item.item_outcome_note || '',
  });

  const updateMutation = useMutation({
    mutationFn: (data: ObjectEntryItemInput) =>
      updateObjectEntryItem(orgId, entryId, item.entry_item_id!, data),
    onSuccess: () => onSaved(),
  });

  const saveField = useCallback(
    (field: keyof ObjectEntryItemInput, value: unknown) => {
      updateMutation.mutate({ [field]: value } as ObjectEntryItemInput);
    },
    [updateMutation]
  );

  const handleChange = (field: string, value: string) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <>
    <div className="px-4 py-3 border-t border-lichen bg-parchment space-y-3">
      <div>
        <label className="block text-xs font-medium text-archive mb-1">Brief Description</label>
        <input
          type="text"
          value={formState.brief_description}
          onChange={(e) => handleChange('brief_description', e.target.value)}
          onBlur={(e) => saveField('brief_description', e.target.value || null)}
          disabled={!canEdit}
          placeholder="Short identifying description"
          className={inputClass}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-archive mb-1">Detailed Description</label>
        <textarea
          value={formState.detailed_description}
          onChange={(e) => handleChange('detailed_description', e.target.value)}
          onBlur={(e) => saveField('detailed_description', e.target.value || null)}
          disabled={!canEdit}
          rows={2}
          placeholder="Longer description, materials, dimensions..."
          className={`${inputClass} resize-none`}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-archive mb-1">Depositor's Object Number</label>
          <input
            type="text"
            value={formState.lender_object_number}
            onChange={(e) => handleChange('lender_object_number', e.target.value)}
            onBlur={(e) => saveField('lender_object_number', e.target.value || null)}
            disabled={!canEdit}
            placeholder="Their reference number"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-archive mb-1">Declared Value</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.01"
              value={formState.declared_value}
              onChange={(e) => handleChange('declared_value', e.target.value)}
              onBlur={(e) => saveField('declared_value', e.target.value ? parseFloat(e.target.value) : null)}
              disabled={!canEdit}
              placeholder="0.00"
              className={inputClass}
            />
            <select
              value={formState.declared_value_currency}
              onChange={(e) => {
                handleChange('declared_value_currency', e.target.value);
                saveField('declared_value_currency', e.target.value);
              }}
              disabled={!canEdit}
              className={`${inputClass} w-24`}
            >
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="CAD">CAD</option>
              <option value="JPY">JPY</option>
            </select>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-archive mb-1">Condition on Receipt</label>
        <textarea
          value={formState.condition_note}
          onChange={(e) => handleChange('condition_note', e.target.value)}
          onBlur={(e) => saveField('condition_note', e.target.value || null)}
          disabled={!canEdit}
          rows={2}
          placeholder="Observed condition, damage, etc..."
          className={`${inputClass} resize-none`}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-archive mb-1">Condition Report</label>
        {item.condition_report_id ? (
          <div className="flex items-center gap-2">
            <Link
              to={`/organizations/${orgId}/collections/condition-reports/${item.condition_report_id}`}
              className="text-sm text-bark hover:underline flex items-center gap-1"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ClipboardCheck size={14} />
              {item.condition_report_number || 'View Report'}
              <ExternalLink size={12} />
            </Link>
            {canEdit && (
              <button
                type="button"
                onClick={() => saveField('condition_report_id', null)}
                className="p-0.5 text-archive hover:text-semantic-error"
                title="Unlink report"
              >
                <X size={14} />
              </button>
            )}
          </div>
        ) : canEdit ? (
          <button
            type="button"
            onClick={() => setShowConditionReportSlideOver(true)}
            className="text-sm text-bark hover:underline inline-flex items-center gap-1"
          >
            <Plus size={14} />
            Create condition report
          </button>
        ) : (
          <span className="text-sm text-archive italic">No condition report</span>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-archive mb-1">Storage Location</label>
        {item.location_id ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink flex items-center gap-1">
              <MapPin size={14} className="text-archive" />
              {item.location_name || '—'}
              {item.location_path && (
                <span className="text-xs text-archive">({item.location_path})</span>
              )}
            </span>
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={() => setShowLocationPicker(true)}
                  className="text-xs text-bark hover:text-copper-dark"
                >
                  Change
                </button>
                <button
                  type="button"
                  onClick={() => saveField('location_id', null)}
                  className="p-0.5 text-archive hover:text-semantic-error"
                  title="Clear location"
                >
                  <X size={12} />
                </button>
              </>
            )}
          </div>
        ) : canEdit ? (
          <button
            type="button"
            onClick={() => setShowLocationPicker(true)}
            className="text-sm text-bark hover:underline inline-flex items-center gap-1"
          >
            <MapPin size={14} />
            Assign location
          </button>
        ) : (
          <span className="text-sm text-archive italic">Not assigned</span>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-archive mb-1">Outcome Note</label>
        <textarea
          value={formState.item_outcome_note}
          onChange={(e) => handleChange('item_outcome_note', e.target.value)}
          onBlur={(e) => saveField('item_outcome_note', e.target.value || null)}
          disabled={!canEdit}
          rows={2}
          placeholder="What happened to this item (returned, acquired, etc.)"
          className={`${inputClass} resize-none`}
        />
      </div>

      {/* Per-item photos */}
      <ItemPhotosBlock
        orgId={orgId}
        entryId={entryId}
        item={item}
        canEdit={canEdit}
        onChanged={onSaved}
      />

      {updateMutation.isPending && (
        <p className="flex items-center gap-1 text-xs text-archive">
          <Loader2 size={12} className="animate-spin" />
          Saving...
        </p>
      )}
    </div>

    <CreateConditionReportSlideOver
      isOpen={showConditionReportSlideOver}
      onClose={() => setShowConditionReportSlideOver(false)}
      orgId={orgId}
      entryItemId={item.entry_item_id!}
      itemBriefDescription={item.brief_description}
      onCreated={(reportId) => {
        saveField('condition_report_id', reportId);
        setShowConditionReportSlideOver(false);
      }}
    />

    <LocationPickerModal
      isOpen={showLocationPicker}
      onClose={() => setShowLocationPicker(false)}
      onSelect={(location: { location_id: string }) => {
        saveField('location_id', location.location_id);
        setShowLocationPicker(false);
      }}
      organizationId={orgId}
      selectedLocationId={item.location_id || undefined}
      title="Select Storage Location"
    />
    </>
  );
}

// ============================================================================
// Create Condition Report Slide-over (for entry items)
// ============================================================================

function CreateConditionReportSlideOver({
  isOpen,
  onClose,
  orgId,
  entryItemId,
  itemBriefDescription,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  entryItemId: string;
  itemBriefDescription?: string | null;
  onCreated: (reportId: string) => void;
}) {
  const [reportType, setReportType] = useState('intake');
  const [overallCondition, setOverallCondition] = useState('');
  const [conditionSummary, setConditionSummary] = useState('');
  const [recommendations, setRecommendations] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setReportType('intake');
    setOverallCondition('');
    setConditionSummary('');
    setRecommendations('');
    setError(null);
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createConditionReport(orgId, {
        report_type: reportType as 'intake' | 'loan_in' | 'loan_out' | 'periodic' | 'conservation' | 'incident',
        linked_entity_type: 'entry_item',
        linked_entity_id: entryItemId,
        overall_condition: (overallCondition || undefined) as 'excellent' | 'good' | 'fair' | 'poor' | 'unacceptable' | null | undefined,
        condition_summary: conditionSummary.trim() || undefined,
        recommendations: recommendations.trim() || undefined,
        status: 'draft',
      }),
    onSuccess: (report) => {
      reset();
      onCreated(report.report_id);
    },
    onError: (err: Error) => setError(err.message || 'Failed to create condition report'),
  });

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={handleClose}
      title="Create Condition Report"
      subtitle={itemBriefDescription ? `For item: ${itemBriefDescription}` : 'For this entry item'}
      width="md"
      footer={
        <div className="flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm text-archive hover:text-ink"
            disabled={createMutation.isPending}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              setError(null);
              createMutation.mutate();
            }}
            disabled={createMutation.isPending}
            className="btn btn-primary text-sm flex items-center gap-2"
          >
            {createMutation.isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Creating...
              </>
            ) : (
              'Create & Link'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
            {error}
          </div>
        )}

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">
            Report Type <span className="text-semantic-error">*</span>
          </label>
          <select
            value={reportType}
            onChange={(e) => setReportType(e.target.value)}
            className={inputClass}
          >
            <option value="intake">Intake (arrival)</option>
            <option value="loan_in">Loan In</option>
            <option value="periodic">Periodic</option>
            <option value="conservation">Conservation</option>
            <option value="incident">Incident</option>
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">Overall Condition</label>
          <select
            value={overallCondition}
            onChange={(e) => setOverallCondition(e.target.value)}
            className={inputClass}
          >
            <option value="">— Select —</option>
            <option value="excellent">Excellent</option>
            <option value="good">Good</option>
            <option value="fair">Fair</option>
            <option value="poor">Poor</option>
            <option value="unacceptable">Unacceptable</option>
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">Condition Summary</label>
          <textarea
            value={conditionSummary}
            onChange={(e) => setConditionSummary(e.target.value)}
            rows={3}
            placeholder="Observed condition, damage, notes..."
            className={`${inputClass} resize-none`}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">Recommendations</label>
          <textarea
            value={recommendations}
            onChange={(e) => setRecommendations(e.target.value)}
            rows={2}
            placeholder="Recommended handling, conservation, etc..."
            className={`${inputClass} resize-none`}
          />
        </div>

        <p className="text-xs text-archive">
          The report will be created as a draft and linked to this entry item. You can open it in full later to add detailed findings.
        </p>
      </div>
    </SlideOver>
  );
}

// ============================================================================
// Add Item Slide-over
// ============================================================================

function AddItemSlideOver({
  isOpen,
  onClose,
  orgId,
  entryId,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  entryId: string;
  onSuccess: () => void;
}) {
  const [briefDescription, setBriefDescription] = useState('');
  const [detailedDescription, setDetailedDescription] = useState('');
  const [lenderObjectNumber, setLenderObjectNumber] = useState('');
  const [declaredValue, setDeclaredValue] = useState('');
  const [declaredValueCurrency, setDeclaredValueCurrency] = useState('USD');
  const [conditionNote, setConditionNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setBriefDescription('');
    setDetailedDescription('');
    setLenderObjectNumber('');
    setDeclaredValue('');
    setDeclaredValueCurrency('USD');
    setConditionNote('');
    setError(null);
  };

  const addMutation = useMutation({
    mutationFn: (data: ObjectEntryItemInput) => addObjectEntryItem(orgId, entryId, data),
    onSuccess: () => {
      reset();
      onSuccess();
    },
    onError: (err: Error) => setError(err.message || 'Failed to add item'),
  });

  const handleSubmit = () => {
    if (!briefDescription.trim()) {
      setError('Brief description is required');
      return;
    }
    setError(null);
    addMutation.mutate({
      brief_description: briefDescription.trim(),
      detailed_description: detailedDescription.trim() || null,
      lender_object_number: lenderObjectNumber.trim() || null,
      declared_value: declaredValue ? parseFloat(declaredValue) : null,
      declared_value_currency: declaredValueCurrency,
      condition_note: conditionNote.trim() || null,
    });
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={handleClose}
      title="Add Entry Item"
      subtitle="Record an individual item within this entry"
      width="md"
      footer={
        <div className="flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm text-archive hover:text-ink"
            disabled={addMutation.isPending}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={addMutation.isPending || !briefDescription.trim()}
            className="btn btn-primary text-sm flex items-center gap-2"
          >
            {addMutation.isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Adding...
              </>
            ) : (
              'Add Item'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
            {error}
          </div>
        )}

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">
            Brief Description <span className="text-semantic-error">*</span>
          </label>
          <input
            type="text"
            value={briefDescription}
            onChange={(e) => setBriefDescription(e.target.value)}
            placeholder="Short identifying description"
            className={inputClass}
            autoFocus
          />
        </div>

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">Detailed Description</label>
          <textarea
            value={detailedDescription}
            onChange={(e) => setDetailedDescription(e.target.value)}
            rows={3}
            placeholder="Longer description, materials, dimensions..."
            className={`${inputClass} resize-none`}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">Depositor's Object Number</label>
          <input
            type="text"
            value={lenderObjectNumber}
            onChange={(e) => setLenderObjectNumber(e.target.value)}
            placeholder="Their reference number"
            className={inputClass}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">Declared Value</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.01"
              value={declaredValue}
              onChange={(e) => setDeclaredValue(e.target.value)}
              placeholder="0.00"
              className={inputClass}
            />
            <select
              value={declaredValueCurrency}
              onChange={(e) => setDeclaredValueCurrency(e.target.value)}
              className={`${inputClass} w-28`}
            >
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="CAD">CAD</option>
              <option value="JPY">JPY</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-ink block mb-1.5">Condition on Receipt</label>
          <textarea
            value={conditionNote}
            onChange={(e) => setConditionNote(e.target.value)}
            rows={3}
            placeholder="Observed condition, damage, any concerns..."
            className={`${inputClass} resize-none`}
          />
        </div>
      </div>
    </SlideOver>
  );
}

// ============================================================================
// Per-item Photos block (inside ItemDetailPanel)
// ============================================================================

function ItemPhotosBlock({
  orgId,
  entryId,
  item,
  canEdit,
  onChanged,
}: {
  orgId: string;
  entryId: string;
  item: EntryItem;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const entryItemId = item.entry_item_id!;
  const photos = (item.media || []).filter((m) => m.media_type === 'image');

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadObjectEntryItemMedia(orgId, entryId, entryItemId, file),
    onSuccess: () => onChanged(),
  });

  const removeMutation = useMutation({
    mutationFn: (mediaId: string) =>
      removeObjectEntryItemMedia(orgId, entryId, entryItemId, mediaId),
    onSuccess: () => onChanged(),
  });

  const setPrimaryMutation = useMutation({
    mutationFn: (mediaId: string) =>
      setObjectEntryItemPrimaryMedia(orgId, entryId, entryItemId, mediaId),
    onSuccess: () => onChanged(),
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      await uploadMutation.mutateAsync(file);
    }
    e.target.value = '';
  };

  const isBusy =
    uploadMutation.isPending || removeMutation.isPending || setPrimaryMutation.isPending;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-xs font-medium text-archive">
          Photos {photos.length > 0 && <span className="text-archive">({photos.length})</span>}
        </label>
        {canEdit && (
          <label
            className={cn(
              'inline-flex items-center gap-1 text-xs text-bark hover:text-copper-dark cursor-pointer',
              isBusy && 'opacity-50 pointer-events-none'
            )}
          >
            {isBusy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            Upload
            <input
              type="file"
              className="hidden"
              accept="image/jpeg,image/png,image/gif,image/webp,image/tiff"
              multiple
              onChange={handleFileChange}
              disabled={isBusy}
            />
          </label>
        )}
      </div>

      {photos.length === 0 ? (
        <div className="text-xs text-archive italic py-2">
          {canEdit ? 'No photos yet — click Upload to add one.' : 'No photos attached.'}
        </div>
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
          {photos.map((photo) => (
            <PhotoThumbnail
              key={photo.media_id}
              photo={photo}
              canEdit={canEdit}
              onRemove={() => removeMutation.mutate(photo.media_id)}
              onSetPrimary={() => setPrimaryMutation.mutate(photo.media_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PhotoThumbnail({
  photo,
  canEdit,
  onRemove,
  onSetPrimary,
}: {
  photo: NonNullable<EntryItem['media']>[number];
  canEdit: boolean;
  onRemove: () => void;
  onSetPrimary: () => void;
}) {
  const src = photo.thumbnail_url || undefined;

  return (
    <div
      className={cn(
        'relative aspect-square rounded overflow-hidden border-2',
        photo.is_primary ? 'border-bark ring-1 ring-bark/30' : 'border-lichen'
      )}
    >
      <img src={src} alt={photo.caption || photo.filename} className="w-full h-full object-cover" />
      {photo.is_primary && (
        <div className="absolute top-0.5 left-0.5 px-1 py-0.5 bg-bark text-parchment rounded text-[10px] font-medium">
          Primary
        </div>
      )}
      {canEdit && (
        <div className="absolute inset-0 bg-ink/50 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
          {!photo.is_primary && (
            <button
              type="button"
              onClick={onSetPrimary}
              className="p-1 text-parchment hover:text-copper-dark text-[10px] bg-bark/80 rounded"
              title="Set as primary"
            >
              Primary
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="p-1 text-parchment hover:text-semantic-error bg-bark/80 rounded"
            title="Remove photo"
          >
            <Trash2 size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
