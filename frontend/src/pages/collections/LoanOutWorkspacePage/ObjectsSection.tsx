import { useState, useCallback } from 'react';
import Checkbox from '../../../components/Checkbox';
import { Link } from 'react-router-dom';
import { Package, ExternalLink, ChevronDown, ChevronRight, Plus, Trash2, ClipboardCheck, LogOut, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WorkspaceSection } from '../../../components/workspace';
import { ObjectSearchDialog } from '../../../components/work/ObjectSearchDialog';
import { addLoanOutObject, updateLoanOutObject, getObjectConditionReports } from '../../../lib/api';
import { apiFetch } from '../../../lib/apiClient';
import { formatNumber } from '@/lib/formatters';
import type { ExistingLoan, LoanObject } from './types';

interface ObjectsSectionProps {
  orgId: string;
  existingLoan: ExistingLoan;
  insuranceCurrency: string;
  isExpanded: boolean;
  isEditing: boolean;
  order: number | undefined;
  onToggle: () => void;
}

interface ObjectDetailPanelProps {
  orgId: string;
  loanId: string;
  obj: LoanObject;
  insuranceCurrency: string;
}

interface ConditionReportPickerProps {
  orgId: string;
  objectId: string;
  label: string;
  currentReportId: string | null | undefined;
  currentReportNumber?: string | null;
  onSelect: (reportId: string | null) => void;
}

function ConditionReportPicker({ orgId, objectId, label, currentReportId, currentReportNumber, onSelect }: ConditionReportPickerProps) {
  const [showPicker, setShowPicker] = useState(false);

  const { data } = useQuery({
    queryKey: ['object-condition-reports', orgId, objectId],
    queryFn: () => getObjectConditionReports(orgId, objectId),
    enabled: showPicker && !!objectId,
  });

  const reports = data?.items || [];

  return (
    <div>
      <label className="block text-xs font-medium text-archive mb-1">{label}</label>
      {currentReportId ? (
        <div className="flex items-center gap-2">
          <Link
            to={`/organizations/${orgId}/collections/condition-reports/${currentReportId}`}
            className="text-sm text-bark hover:underline flex items-center gap-1"
          >
            <ClipboardCheck size={14} />
            {currentReportNumber || 'View Report'}
          </Link>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="p-0.5 text-archive hover:text-semantic-error"
            title="Unlink report"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowPicker(!showPicker)}
          className="text-sm text-bark hover:underline"
        >
          + Link condition report
        </button>
      )}
      {showPicker && !currentReportId && (
        <div className="mt-2 border border-lichen rounded-lg bg-surface max-h-40 overflow-y-auto">
          {reports.length === 0 ? (
            <div className="px-3 py-2 text-xs text-archive">
              No condition reports for this object.{' '}
              <Link
                to={`/organizations/${orgId}/collections/condition-reports/create?object_id=${objectId}&report_type=loan_out`}
                className="text-bark hover:underline"
              >
                Create one
              </Link>
            </div>
          ) : (
            reports.map((report: any) => (
              <button
                key={report.report_id}
                type="button"
                onClick={() => {
                  onSelect(report.report_id);
                  setShowPicker(false);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-stone/50 flex items-center gap-2 border-b border-lichen last:border-b-0"
              >
                <ClipboardCheck size={14} className="text-archive" />
                <span className="text-ink">{report.report_number || report.report_id.slice(0, 8)}</span>
                {report.condition_rating && (
                  <span className="text-xs text-archive capitalize">{report.condition_rating}</span>
                )}
                {report.report_date && (
                  <span className="text-xs text-archive ml-auto">{report.report_date}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ObjectDetailPanel({ orgId, loanId, obj, insuranceCurrency: _insuranceCurrency }: ObjectDetailPanelProps) {
  const queryClient = useQueryClient();

  const [formState, setFormState] = useState({
    valuation: obj.valuation != null ? String(obj.valuation) : '',
    valuation_currency: obj.valuation_currency || 'USD',
    valuation_date: obj.valuation_date || '',
    ip_rights_note: obj.ip_rights_note || '',
    estimated_costs: obj.estimated_costs != null ? String(obj.estimated_costs) : '',
    estimated_costs_currency: obj.estimated_costs_currency || 'USD',
    estimated_costs_note: obj.estimated_costs_note || '',
    photography_permitted: obj.photography_permitted ?? null,
    reproduction_rights_note: obj.reproduction_rights_note || '',
    dimensions_note: obj.dimensions_note || '',
  });

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      updateLoanOutObject(orgId, loanId, obj.loan_object_id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan-out', orgId, loanId] });
    },
  });

  const saveField = useCallback(
    (field: string, value: unknown) => {
      mutation.mutate({ [field]: value });
    },
    [mutation]
  );

  return (
    <div className="px-4 py-3 border-t border-lichen bg-parchment space-y-3">
      {/* Condition Reports */}
      {obj.object_id && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ConditionReportPicker
            orgId={orgId}
            objectId={obj.object_id}
            label="Outbound Condition Report"
            currentReportId={obj.condition_report_out_id}
            currentReportNumber={obj.condition_report_out_number}
            onSelect={(reportId) => saveField('condition_report_out_id', reportId)}
          />
          <ConditionReportPicker
            orgId={orgId}
            objectId={obj.object_id}
            label="Return Condition Report"
            currentReportId={obj.condition_report_return_id}
            currentReportNumber={obj.condition_report_return_number}
            onSelect={(reportId) => saveField('condition_report_return_id', reportId)}
          />
        </div>
      )}

      {/* Object Exit */}
      {obj.exit_id && (
        <div>
          <label className="block text-xs font-medium text-archive mb-1">Object Exit</label>
          <Link
            to={`/organizations/${orgId}/collections/exits/${obj.exit_id}`}
            className="text-sm text-bark hover:underline flex items-center gap-1"
          >
            <LogOut size={14} />
            {obj.exit_number || 'View Exit Record'}
          </Link>
        </div>
      )}

      {/* Row 1: Valuation */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-archive mb-1">Valuation</label>
          <input
            type="number"
            className="w-full rounded border border-lichen bg-parchment px-2 py-1.5 text-sm text-ink
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            value={formState.valuation}
            onChange={(e) => setFormState((p) => ({ ...p, valuation: e.target.value }))}
            onBlur={() => saveField('valuation', formState.valuation ? parseFloat(formState.valuation) : null)}
            placeholder={`Value (${formState.valuation_currency})`}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-archive mb-1">Valuation Date</label>
          <input
            type="date"
            className="w-full rounded border border-lichen bg-parchment px-2 py-1.5 text-sm text-ink
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            value={formState.valuation_date}
            onChange={(e) => {
              setFormState((p) => ({ ...p, valuation_date: e.target.value }));
              saveField('valuation_date', e.target.value || null);
            }}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-archive mb-1">Estimated Costs</label>
          <input
            type="number"
            className="w-full rounded border border-lichen bg-parchment px-2 py-1.5 text-sm text-ink
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            value={formState.estimated_costs}
            onChange={(e) => setFormState((p) => ({ ...p, estimated_costs: e.target.value }))}
            onBlur={() => saveField('estimated_costs', formState.estimated_costs ? parseFloat(formState.estimated_costs) : null)}
            placeholder={`Costs (${formState.estimated_costs_currency})`}
          />
        </div>
      </div>

      {/* Row 2: IP Rights & Reproduction */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-archive mb-1">IP Rights</label>
          <textarea
            rows={2}
            className="w-full rounded border border-lichen bg-parchment px-2 py-1.5 text-sm text-ink
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            value={formState.ip_rights_note}
            onChange={(e) => setFormState((p) => ({ ...p, ip_rights_note: e.target.value }))}
            onBlur={() => saveField('ip_rights_note', formState.ip_rights_note)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-archive mb-1">Reproduction Rights</label>
          <textarea
            rows={2}
            className="w-full rounded border border-lichen bg-parchment px-2 py-1.5 text-sm text-ink
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            value={formState.reproduction_rights_note}
            onChange={(e) => setFormState((p) => ({ ...p, reproduction_rights_note: e.target.value }))}
            onBlur={() => saveField('reproduction_rights_note', formState.reproduction_rights_note)}
          />
        </div>
      </div>

      {/* Row 3: Photography & Dimensions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex items-center gap-2 text-xs font-medium text-archive cursor-pointer">
          <Checkbox
            checked={formState.photography_permitted === true}
            onChange={(e) => {
              const val = e.target.checked;
              setFormState((p) => ({ ...p, photography_permitted: val }));
              saveField('photography_permitted', val);
            }}
          />
          Photography Permitted
        </label>
        <div>
          <label className="block text-xs font-medium text-archive mb-1">Dimensions</label>
          <textarea
            rows={2}
            className="w-full rounded border border-lichen bg-parchment px-2 py-1.5 text-sm text-ink
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            value={formState.dimensions_note}
            onChange={(e) => setFormState((p) => ({ ...p, dimensions_note: e.target.value }))}
            onBlur={() => saveField('dimensions_note', formState.dimensions_note)}
          />
        </div>
      </div>

      {mutation.isError && (
        <p className="text-xs text-semantic-error">Failed to save. Please try again.</p>
      )}
    </div>
  );
}

export function ObjectsSection({
  orgId,
  existingLoan,
  insuranceCurrency,
  isExpanded,
  isEditing,
  order,
  onToggle,
}: ObjectsSectionProps) {
  const queryClient = useQueryClient();
  const [expandedObjects, setExpandedObjects] = useState<Set<string>>(new Set());
  const [showObjectSearch, setShowObjectSearch] = useState(false);

  const loanId = existingLoan.loan_out_id;
  const objects = existingLoan.objects || [];
  const canAddRemove = isEditing && !['in_transit', 'on_loan', 'returned', 'closed'].includes(existingLoan.status || '');

  const addObjectMutation = useMutation({
    mutationFn: (objectId: string) => addLoanOutObject(orgId, loanId, { object_id: objectId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan-out', orgId, loanId] });
    },
  });

  const removeObjectMutation = useMutation({
    mutationFn: (loanObjectId: string) =>
      apiFetch(`/organizations/${orgId}/collections/loans-out/${loanId}/objects/${loanObjectId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan-out', orgId, loanId] });
    },
  });

  const toggleObjectExpanded = useCallback((loanObjectId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExpandedObjects((prev) => {
      const next = new Set(prev);
      if (next.has(loanObjectId)) {
        next.delete(loanObjectId);
      } else {
        next.add(loanObjectId);
      }
      return next;
    });
  }, []);

  return (
    <WorkspaceSection
      id="objects"
      title="Loan Objects"
      icon={<Package size={18} />}
      badge={objects.length > 0 ? objects.length.toString() : undefined}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={order}
    >
      {objects.length === 0 ? (
        <div className="text-center py-8">
          <Package size={32} className="mx-auto text-archive mb-3" />
          <p className="text-sm text-archive mb-4">No objects added to this loan yet</p>
          {canAddRemove && (
            <button
              type="button"
              onClick={() => setShowObjectSearch(true)}
              className="btn btn-primary"
              disabled={addObjectMutation.isPending}
            >
              <Plus size={16} className="mr-1.5" />
              Add Object
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Add Object button */}
          {canAddRemove && (
            <div className="flex justify-end mb-2">
              <button
                type="button"
                onClick={() => setShowObjectSearch(true)}
                className="btn btn-secondary text-sm"
                disabled={addObjectMutation.isPending}
              >
                <Plus size={14} className="mr-1" />
                Add Object
              </button>
            </div>
          )}

          {objects.map((obj: LoanObject) => {
            const isObjExpanded = expandedObjects.has(obj.loan_object_id);

            return (
              <div key={obj.loan_object_id} className="relative">
                <div
                  className={`bg-stone/30 border rounded-lg overflow-hidden transition-colors ${
                    isObjExpanded ? 'border-bark/40' : 'border-stone hover:border-archive'
                  }`}
                >
                  {/* Header row */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={(e) => toggleObjectExpanded(obj.loan_object_id, e)}
                      className="p-0.5 text-archive hover:text-ink transition-colors"
                    >
                      {isObjExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-ink">
                          {obj.object?.object_number || 'No number'}
                        </span>
                        {(obj.object?.title || obj.object?.object_name) && (
                          <span className="text-sm text-archive truncate">
                            — {obj.object?.title || obj.object?.object_name}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Condition report & exit indicators */}
                    {(obj.condition_report_out_id || obj.condition_report_return_id) && (
                      <span className="hidden sm:flex items-center gap-1 text-xs text-forest flex-shrink-0">
                        <ClipboardCheck size={12} />
                        {obj.condition_report_out_id && obj.condition_report_return_id ? '2 reports' : '1 report'}
                      </span>
                    )}
                    {obj.exit_id && (
                      <Link
                        to={`/organizations/${orgId}/collections/exits/${obj.exit_id}`}
                        className="hidden sm:flex items-center gap-1 text-xs text-archive hover:text-bark flex-shrink-0"
                        title={obj.exit_number || 'View exit record'}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <LogOut size={12} />
                        {obj.exit_number || 'Exit'}
                      </Link>
                    )}

                    {obj.insurance_value != null && (
                      <span className="hidden sm:inline text-xs text-archive flex-shrink-0">
                        Insurance: {insuranceCurrency} {formatNumber(obj.insurance_value)}
                      </span>
                    )}

                    {obj.object_id && (
                      <Link
                        to={`/organizations/${orgId}/collections/objects/${obj.object_id}`}
                        className="p-1 text-archive hover:text-bark transition-colors"
                        title="View object record"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink size={14} />
                      </Link>
                    )}

                    {canAddRemove && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeObjectMutation.mutate(obj.loan_object_id);
                        }}
                        disabled={removeObjectMutation.isPending}
                        className="p-1 text-archive hover:text-semantic-error transition-colors"
                        title="Remove from loan"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>

                  {/* Expanded detail panel */}
                  {isObjExpanded && (
                    <ObjectDetailPanel
                      orgId={orgId}
                      loanId={loanId}
                      obj={obj}
                      insuranceCurrency={insuranceCurrency}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Object Search Dialog */}
      <ObjectSearchDialog
        isOpen={showObjectSearch}
        onClose={() => setShowObjectSearch(false)}
        onSelect={(object) => {
          addObjectMutation.mutate(object.object_id);
          setShowObjectSearch(false);
        }}
        title="Add Object to Loan"
      />
    </WorkspaceSection>
  );
}
