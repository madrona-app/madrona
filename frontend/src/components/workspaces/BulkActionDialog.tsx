/**
 * BulkActionDialog - Execute bulk actions on workspace objects
 *
 * Multi-step wizard for:
 * 1. Select action and configure parameters
 * 2. Preview affected objects with warnings
 * 3. Validate (check permissions/business rules)
 * 4. Execute and show results
 */

import { useState, useEffect } from 'react';
import Checkbox from '../Checkbox';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  X,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  Check,
  XCircle,
  Loader2,
  Package,
  MapPin,
  FileText,
  AlertOctagon,
  Zap,
  Upload,
} from 'lucide-react';
import { MadronaLoader } from '../ui/MadronaLoader';
import { useOrganization } from '../../contexts/useOrganization';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { cn } from '../../lib/utils';
import {
  listBulkActions,
  previewBulkAction,
  validateBulkAction,
  executeBulkAction,
  type BulkActionConfig,
  type BulkActionPreviewResult,
  type BulkActionValidateResult,
  type BulkActionExecuteResult,
} from '../../lib/api';
import { LocationPickerButton } from '../collections/LocationPickerModal';
import { ModalPortal } from '../ModalPortal';
import { useStableCallback } from '../workspace/useStableCallback';
import { useLookupValues } from '../../hooks/useLookupValues';

interface BulkActionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  workspaceName: string;
  objectCount: number;
}

type Step = 'select' | 'configure' | 'preview' | 'validate' | 'execute' | 'results';

const STEPS: Step[] = ['select', 'configure', 'preview', 'validate', 'execute', 'results'];

const STEP_LABELS: Record<Step, string> = {
  select: 'Select an action',
  configure: 'Configure',
  preview: 'Preview',
  validate: 'Validate',
  execute: 'Confirm',
  results: 'Results',
};

const actionIcons: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  record_movement: MapPin,
  create_condition_report: FileText,
  report_incident: AlertOctagon,
  set_cataloging_status: FileText,
  set_object_status: Package,
  add_to_loan: Upload,
  set_loan_availability: Check,
  schedule_condition_check: AlertTriangle,
  flag_for_conservation: AlertOctagon,
  set_handling_requirements: AlertTriangle,
  set_last_inventoried: Check,
};

export default function BulkActionDialog({
  isOpen,
  onClose,
  workspaceId,
  workspaceName,
  objectCount,
}: BulkActionDialogProps) {
  const { activeOrganization } = useOrganization();
  const orgId = activeOrganization?.organization_id;
  // Lookup-backed choices come from the organization's lookup values, as on the
  // single-record forms, so org-added values are offered and saved.
  const { getLookup } = useLookupValues({ enabled: isOpen });
  const lookupOptions = (options: ReturnType<typeof getLookup>) =>
    options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ));

  const stableOnClose = useStableCallback(onClose);
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose: stableOnClose,
    titlePrefix: 'bulk-action-dialog',
  });

  const [step, setStep] = useState<Step>('select');
  const [selectedAction, setSelectedAction] = useState<BulkActionConfig | null>(null);
  const [actionParams, setActionParams] = useState<Record<string, unknown>>({});
  const [previewData, setPreviewData] = useState<BulkActionPreviewResult | null>(null);
  const [validateData, setValidateData] = useState<BulkActionValidateResult | null>(null);
  const [executeData, setExecuteData] = useState<BulkActionExecuteResult | null>(null);
  const [skipBlocked, setSkipBlocked] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch available actions
  const { data: actionsData, isLoading: isLoadingActions } = useQuery({
    queryKey: ['bulk-actions', orgId, workspaceId],
    queryFn: () => listBulkActions(orgId!, workspaceId),
    enabled: !!orgId && isOpen,
  });

  // Preview mutation
  const previewMutation = useMutation({
    mutationFn: () => previewBulkAction(orgId!, workspaceId, selectedAction!.key, actionParams),
    onSuccess: (data) => {
      setPreviewData(data);
      setError(null);
      setStep('preview');
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to preview action');
    },
  });

  // Validate mutation
  const validateMutation = useMutation({
    mutationFn: () => validateBulkAction(orgId!, workspaceId, selectedAction!.key, actionParams),
    onSuccess: (data) => {
      setValidateData(data);
      setError(null);
      setStep('validate');
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to validate action');
    },
  });

  // Execute mutation
  const executeMutation = useMutation({
    mutationFn: () =>
      executeBulkAction(orgId!, workspaceId, selectedAction!.key, actionParams, undefined, skipBlocked),
    onSuccess: (data) => {
      setExecuteData(data);
      setError(null);
      setStep('results');
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to execute action');
    },
  });

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setStep('select');
      setSelectedAction(null);
      setActionParams({});
      setPreviewData(null);
      setValidateData(null);
      setExecuteData(null);
      setError(null);
    }
  }, [isOpen]);

  const handleSelectAction = (action: BulkActionConfig) => {
    setSelectedAction(action);
    setActionParams({});
    setStep('configure');
  };

  const handleBack = () => {
    if (step === 'configure') setStep('select');
    else if (step === 'preview') setStep('configure');
    else if (step === 'validate') setStep('preview');
  };

  const handleNext = () => {
    if (step === 'configure') {
      // Validate required params
      const missing = selectedAction!.required_params.filter((p) => !actionParams[p]);
      if (missing.length > 0) {
        setError(`Missing required fields: ${missing.join(', ')}`);
        return;
      }
      setError(null);
      previewMutation.mutate();
    } else if (step === 'preview') {
      validateMutation.mutate();
    } else if (step === 'validate') {
      setStep('execute');
    }
  };

  const handleExecute = () => {
    executeMutation.mutate();
  };

  if (!isOpen) return null;

  const isLoading = previewMutation.isPending || validateMutation.isPending || executeMutation.isPending;

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      {/* Backdrop: mouse dismiss only; Escape closes via useAccessibleModal */}
      <div aria-hidden="true" className="absolute inset-0 bg-ink/50" onClick={onClose} />
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId, descriptionId)}
        className="relative bg-parchment rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen">
          <div className="flex items-center justify-between">
            <div>
              <h2 id={titleId} className="text-lg font-semibold text-ink flex items-center gap-2">
                <Zap size={20} className="text-bark" />
                Bulk Action
              </h2>
              <p id={descriptionId} className="text-sm text-archive">
                {workspaceName} ({objectCount} objects)
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close bulk action dialog"
              className="p-1 text-archive hover:text-ink rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Progress indicator (visual dots; the step is announced as text) */}
        <p className="sr-only" aria-live="polite">
          Step {STEPS.indexOf(step) + 1} of {STEPS.length}: {STEP_LABELS[step]}
        </p>
        <div aria-hidden="true" className="flex items-center gap-1 px-6 py-2 bg-stone/30 border-b border-lichen">
          {STEPS.map(
            (s, idx) => (
              <div key={s} className="flex items-center">
                <div
                  className={cn(
                    'w-2 h-2 rounded-full',
                    step === s
                      ? 'bg-bark'
                      : STEPS.indexOf(step) > idx
                      ? 'bg-bark/50'
                      : 'bg-lichen'
                  )}
                />
                {idx < 5 && <div className="w-6 h-px bg-lichen mx-1" />}
              </div>
            )
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div
              role="alert"
              className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm text-sm text-semantic-error flex items-start gap-2"
            >
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
              {error}
            </div>
          )}

          {/* Step: Select Action */}
          {step === 'select' && (
            <div>
              <h3 className="text-sm font-medium text-ink mb-3">Select an action</h3>
              {isLoadingActions ? (
                <div className="text-center py-8 text-archive">Loading actions...</div>
              ) : !actionsData?.actions.length ? (
                <div className="text-center py-8 text-archive">
                  No actions available. You may need additional permissions.
                </div>
              ) : (
                <div className="space-y-2">
                  {actionsData.actions.map((action) => {
                    const Icon = actionIcons[action.key] || Zap;
                    return (
                      <button
                        type="button"
                        key={action.key}
                        onClick={() => handleSelectAction(action)}
                        className="w-full flex items-center gap-3 p-4 border border-lichen rounded-sm text-left hover:border-bark/50 hover:bg-bark/5 transition-colors"
                      >
                        <div className="p-2 bg-bark/10 rounded-sm">
                          <Icon size={20} className="text-bark" aria-hidden="true" />
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-ink">{action.label}</div>
                          <div className="text-sm text-archive">{action.description}</div>
                        </div>
                        <ChevronRight size={16} className="text-archive" aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Step: Configure */}
          {step === 'configure' && selectedAction && (
            <div>
              <h3 className="text-sm font-medium text-ink mb-3">Configure: {selectedAction.label}</h3>

              {selectedAction.key === 'record_movement' && (
                <div className="space-y-4">
                  {/* LocationPickerButton takes no id, so the visible label names a group around it */}
                  <div role="group" aria-labelledby="bulk-action-destination-label">
                    <span
                      id="bulk-action-destination-label"
                      className="block text-sm font-medium text-ink mb-1"
                    >
                      Destination Location <span className="text-semantic-error" aria-hidden="true">*</span>
                      <span className="sr-only"> (required)</span>
                    </span>
                    <LocationPickerButton
                      labelId="bulk-action-destination-label"
                      organizationId={orgId!}
                      value={(actionParams.to_location_id as string) || null}
                      onChange={(locationId) =>
                        setActionParams({ ...actionParams, to_location_id: locationId || '' })
                      }
                      placeholder="Select destination location..."
                    />
                  </div>
                  <div>
                    <label htmlFor="bulk-action-reason-2" className="block text-sm font-medium text-ink mb-1">
                      Reason <span className="text-semantic-error" aria-hidden="true">*</span>
                    </label>
                    <select
                      id="bulk-action-reason-2"
                      aria-required="true"
                      value={(actionParams.reason as string) || ''}
                      onChange={(e) => setActionParams({ ...actionParams, reason: e.target.value })}
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    >
                      <option value="">Select reason...</option>
                      <option value="storage">Storage</option>
                      <option value="conservation">Conservation</option>
                      <option value="exhibition">Exhibition</option>
                      <option value="loan">Loan</option>
                      <option value="photography">Photography</option>
                      <option value="research">Research</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="bulk-action-note" className="block text-sm font-medium text-ink mb-1">Note (optional)</label>
                    <textarea
                      id="bulk-action-note"
                      value={(actionParams.movement_note as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, movement_note: e.target.value })
                      }
                      rows={2}
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                      placeholder="Add a note about this movement..."
                    />
                  </div>
                </div>
              )}

              {selectedAction.key === 'create_condition_report' && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="bulk-action-report-type" className="block text-sm font-medium text-ink mb-1">
                      Report Type <span className="text-semantic-error" aria-hidden="true">*</span>
                    </label>
                    <select
                      id="bulk-action-report-type"
                      aria-required="true"
                      value={(actionParams.report_type as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, report_type: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    >
                      <option value="">Select type...</option>
                      {lookupOptions(getLookup('report_type'))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="bulk-action-overall-condition" className="block text-sm font-medium text-ink mb-1">
                      Overall Condition (optional)
                    </label>
                    <select
                      id="bulk-action-overall-condition"
                      value={(actionParams.overall_condition as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, overall_condition: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    >
                      <option value="">To be determined...</option>
                      {lookupOptions(getLookup('condition'))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="bulk-action-summary" className="block text-sm font-medium text-ink mb-1">
                      Summary (optional)
                    </label>
                    <textarea
                      id="bulk-action-summary"
                      value={(actionParams.condition_summary as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, condition_summary: e.target.value })
                      }
                      rows={2}
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                      placeholder="Brief condition summary..."
                    />
                  </div>
                </div>
              )}

              {selectedAction.key === 'report_incident' && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="bulk-action-incident-type" className="block text-sm font-medium text-ink mb-1">
                      Incident Type <span className="text-semantic-error" aria-hidden="true">*</span>
                    </label>
                    <select
                      id="bulk-action-incident-type"
                      aria-required="true"
                      value={(actionParams.incident_type as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, incident_type: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    >
                      <option value="">Select type...</option>
                      {lookupOptions(getLookup('incident_type'))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="bulk-action-description-2" className="block text-sm font-medium text-ink mb-1">
                      Description <span className="text-semantic-error" aria-hidden="true">*</span>
                    </label>
                    <textarea
                      id="bulk-action-description-2"
                      aria-required="true"
                      value={(actionParams.incident_description as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, incident_description: e.target.value })
                      }
                      rows={3}
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                      placeholder="Describe the incident..."
                    />
                  </div>
                </div>
              )}

              {selectedAction.key === 'set_cataloging_status' && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="bulk-action-cataloging-status" className="block text-sm font-medium text-ink mb-1">
                      Cataloging Status <span className="text-semantic-error" aria-hidden="true">*</span>
                    </label>
                    <select
                      id="bulk-action-cataloging-status"
                      aria-required="true"
                      value={(actionParams.cataloging_status as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, cataloging_status: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    >
                      <option value="">Select status...</option>
                      <option value="not_started">Not Started</option>
                      <option value="in_progress">In Progress</option>
                      <option value="pending_review">Pending Review</option>
                      <option value="needs_research">Needs Research</option>
                      <option value="cataloged">Cataloged</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="bulk-action-notes-3" className="block text-sm font-medium text-ink mb-1">Notes (optional)</label>
                    <textarea
                      id="bulk-action-notes-3"
                      value={(actionParams.cataloging_notes as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, cataloging_notes: e.target.value })
                      }
                      rows={2}
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                      placeholder="Add cataloging notes..."
                    />
                  </div>
                </div>
              )}

              {selectedAction.key === 'set_object_status' && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="bulk-action-object-status" className="block text-sm font-medium text-ink mb-1">
                      Object Status <span className="text-semantic-error" aria-hidden="true">*</span>
                    </label>
                    <select
                      id="bulk-action-object-status"
                      aria-required="true"
                      value={(actionParams.object_status as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, object_status: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    >
                      <option value="">Select status...</option>
                      <option value="pending">Pending</option>
                      <option value="accessioned">Accessioned</option>
                      <option value="on_loan">On Loan</option>
                      <option value="deaccessioned">Deaccessioned</option>
                      <option value="missing">Missing</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="bulk-action-status-notes" className="block text-sm font-medium text-ink mb-1">Status Notes (optional)</label>
                    <textarea
                      id="bulk-action-status-notes"
                      value={(actionParams.status_notes as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, status_notes: e.target.value })
                      }
                      rows={2}
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                      placeholder="Add status change notes..."
                    />
                  </div>
                </div>
              )}

              {selectedAction.key === 'set_last_inventoried' && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="bulk-inventoried-date" className="block text-sm font-medium text-ink mb-1">
                      Inventoried date (optional)
                    </label>
                    <input
                      id="bulk-inventoried-date"
                      type="date"
                      aria-describedby="bulk-inventoried-date-hint"
                      value={(actionParams.inventoried_date as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, inventoried_date: e.target.value || undefined })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    />
                    <p id="bulk-inventoried-date-hint" className="text-xs text-accessible-gray mt-1">
                      Leave empty to use today. Your name is recorded as the person who inventoried them.
                    </p>
                  </div>
                </div>
              )}

              {selectedAction.key === 'add_to_loan' && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="bulk-action-loan-id" className="block text-sm font-medium text-ink mb-1">
                      Loan ID <span className="text-semantic-error" aria-hidden="true">*</span>
                    </label>
                    <input
                      id="bulk-action-loan-id"
                      aria-required="true"
                      type="text"
                      value={(actionParams.loan_id as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, loan_id: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                      placeholder="Enter loan ID..."
                    />
                    <p className="text-xs text-archive mt-1">Enter the ID of an existing outgoing loan</p>
                  </div>
                  <div>
                    <label htmlFor="bulk-action-notes-2" className="block text-sm font-medium text-ink mb-1">Notes (optional)</label>
                    <textarea
                      id="bulk-action-notes-2"
                      value={(actionParams.loan_notes as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, loan_notes: e.target.value })
                      }
                      rows={2}
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                      placeholder="Add loan notes..."
                    />
                  </div>
                </div>
              )}

              {selectedAction.key === 'set_loan_availability' && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="bulk-action-loan-availability" className="block text-sm font-medium text-ink mb-1">
                      Loan Availability <span className="text-semantic-error" aria-hidden="true">*</span>
                    </label>
                    <select
                      id="bulk-action-loan-availability"
                      aria-required="true"
                      value={(actionParams.loan_availability as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, loan_availability: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    >
                      <option value="">Select availability...</option>
                      <option value="available">Available for Loan</option>
                      <option value="conditional">Conditional (with restrictions)</option>
                      <option value="unavailable">Unavailable for Loan</option>
                      <option value="under_review">Under Review</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="bulk-action-reason" className="block text-sm font-medium text-ink mb-1">Reason (optional)</label>
                    <textarea
                      id="bulk-action-reason"
                      value={(actionParams.availability_reason as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, availability_reason: e.target.value })
                      }
                      rows={2}
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                      placeholder="Reason for availability status..."
                    />
                  </div>
                  <div>
                    <label htmlFor="bulk-action-review-date" className="block text-sm font-medium text-ink mb-1">Review Date (optional)</label>
                    <input
                      id="bulk-action-review-date"
                      type="date"
                      value={(actionParams.review_date as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, review_date: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    />
                  </div>
                </div>
              )}

              {selectedAction.key === 'schedule_condition_check' && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="bulk-action-check-type" className="block text-sm font-medium text-ink mb-1">
                      Check Type <span className="text-semantic-error" aria-hidden="true">*</span>
                    </label>
                    <select
                      id="bulk-action-check-type"
                      aria-required="true"
                      value={(actionParams.check_type as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, check_type: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    >
                      <option value="">Select type...</option>
                      <option value="periodic">Periodic Check</option>
                      <option value="pre_loan">Pre-Loan Check</option>
                      <option value="post_loan">Post-Loan Check</option>
                      <option value="exhibition">Exhibition Check</option>
                      <option value="audit">Audit Check</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="bulk-action-due-date" className="block text-sm font-medium text-ink mb-1">
                      Due Date <span className="text-semantic-error" aria-hidden="true">*</span>
                    </label>
                    <input
                      id="bulk-action-due-date"
                      aria-required="true"
                      type="date"
                      value={(actionParams.due_date as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, due_date: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    />
                  </div>
                  <div>
                    <label htmlFor="bulk-action-priority" className="block text-sm font-medium text-ink mb-1">Priority</label>
                    <select
                      id="bulk-action-priority"
                      value={(actionParams.priority as string) || 'normal'}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, priority: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    >
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="bulk-action-notes" className="block text-sm font-medium text-ink mb-1">Notes (optional)</label>
                    <textarea
                      id="bulk-action-notes"
                      value={(actionParams.notes as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, notes: e.target.value })
                      }
                      rows={2}
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                      placeholder="Add notes for the condition check..."
                    />
                  </div>
                </div>
              )}

              {selectedAction.key === 'flag_for_conservation' && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="bulk-action-urgency" className="block text-sm font-medium text-ink mb-1">
                      Urgency <span className="text-semantic-error" aria-hidden="true">*</span>
                    </label>
                    <select
                      id="bulk-action-urgency"
                      aria-required="true"
                      value={(actionParams.urgency as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, urgency: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    >
                      <option value="">Select urgency...</option>
                      {lookupOptions(getLookup('priority'))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="bulk-action-treatment-type" className="block text-sm font-medium text-ink mb-1">
                      Treatment Type <span className="text-semantic-error" aria-hidden="true">*</span>
                    </label>
                    <select
                      id="bulk-action-treatment-type"
                      aria-required="true"
                      value={(actionParams.treatment_type as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, treatment_type: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    >
                      <option value="">Select treatment type...</option>
                      {lookupOptions(getLookup('treatment_type'))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="bulk-action-description" className="block text-sm font-medium text-ink mb-1">Description (optional)</label>
                    <textarea
                      id="bulk-action-description"
                      value={(actionParams.concern_description as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, concern_description: e.target.value })
                      }
                      rows={3}
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                      placeholder="Describe the conservation concern..."
                    />
                  </div>
                </div>
              )}

              {selectedAction.key === 'set_handling_requirements' && (
                <div className="space-y-4">
                  <fieldset>
                    <legend className="block text-sm font-medium text-ink mb-1">
                      Handling Requirements <span className="text-semantic-error" aria-hidden="true">*</span>
                      <span className="sr-only"> (required)</span>
                    </legend>
                    <div className="space-y-2">
                      {[
                        { value: 'gloves_required', label: 'Gloves Required' },
                        { value: 'two_person_lift', label: 'Two-Person Lift' },
                        { value: 'fragile', label: 'Fragile - Handle with Care' },
                        { value: 'no_stacking', label: 'No Stacking' },
                        { value: 'upright_only', label: 'Keep Upright' },
                        { value: 'climate_controlled', label: 'Climate Controlled Transit' },
                        { value: 'no_vibration', label: 'Avoid Vibration' },
                        { value: 'conservation_mount', label: 'Use Conservation Mount' },
                      ].map((req) => (
                        <label
                          key={req.value}
                          htmlFor={`bulk-action-handling-${req.value}`}
                          className="flex items-center gap-2"
                        >
                          <Checkbox
                            id={`bulk-action-handling-${req.value}`}
                            checked={(actionParams.handling_requirements as string[] || []).includes(req.value)}
                            onChange={(e) => {
                              const current = (actionParams.handling_requirements as string[]) || [];
                              const updated = e.target.checked
                                ? [...current, req.value]
                                : current.filter((r) => r !== req.value);
                              setActionParams({ ...actionParams, handling_requirements: updated });
                            }}
                            className="rounded border-lichen"
                          />
                          <span className="text-sm">{req.label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div>
                    <label htmlFor="bulk-action-additional-notes" className="block text-sm font-medium text-ink mb-1">Additional Notes (optional)</label>
                    <textarea
                      id="bulk-action-additional-notes"
                      value={(actionParams.handling_notes as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, handling_notes: e.target.value })
                      }
                      rows={2}
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                      placeholder="Additional handling instructions..."
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step: Preview */}
          {step === 'preview' && previewData && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-ink">
                  Preview: {previewData.total_count} objects
                </h3>
                {previewData.has_warnings && (
                  <span className="text-xs text-semantic-warning flex items-center gap-1">
                    <AlertTriangle size={12} />
                    {previewData.objects.filter(o => o.warnings.length > 0).length} object(s) have warnings
                  </span>
                )}
              </div>
              <div
                role="region"
                aria-label="Objects to be affected"
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable region must take keyboard focus to scroll
                tabIndex={0}
                className="max-h-64 overflow-y-auto border border-lichen rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30"
              >
                {previewData.objects.map((obj) => (
                  <div
                    key={obj.object_id}
                    className="flex items-center gap-3 p-3 border-b border-lichen last:border-b-0"
                  >
                    {obj.thumbnail_url ? (
                      <img
                        src={obj.thumbnail_url}
                        alt=""
                        className="w-10 h-10 object-cover rounded"
                      />
                    ) : (
                      <div className="w-10 h-10 bg-stone/50 rounded flex items-center justify-center">
                        <Package size={16} className="text-archive" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-archive">{obj.accession_number}</div>
                      <div className="text-sm font-medium text-ink truncate">
                        {obj.title || 'Untitled'}
                      </div>
                    </div>
                    {obj.warnings.length > 0 && (
                      <div className="flex items-center gap-1 text-xs text-semantic-warning">
                        <AlertTriangle size={14} className="flex-shrink-0" />
                        <span>{obj.warnings.join('; ')}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step: Validate */}
          {step === 'validate' && validateData && (
            <div>
              <h3 className="text-sm font-medium text-ink mb-3">Validation Results</h3>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="p-3 bg-semantic-success/10 border border-semantic-success/30 rounded-sm">
                  <div className="text-2xl font-bold text-semantic-success">
                    {validateData.allowed_count}
                  </div>
                  <div className="text-sm text-semantic-success">Ready to process</div>
                </div>
                {validateData.blocked_count > 0 && (
                  <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm">
                    <div className="text-2xl font-bold text-semantic-error">
                      {validateData.blocked_count}
                    </div>
                    <div className="text-sm text-semantic-error">Blocked</div>
                  </div>
                )}
              </div>

              {validateData.blocked.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-xs font-medium text-archive uppercase mb-2">
                    Blocked Objects
                  </h4>
                  <div
                role="region"
                aria-label="Blocked objects"
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable region must take keyboard focus to scroll
                tabIndex={0}
                className="max-h-32 overflow-y-auto border border-lichen rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30"
              >
                    {validateData.blocked.map((obj) => (
                      <div
                        key={obj.object_id}
                        className="flex items-center justify-between p-2 border-b border-lichen last:border-b-0"
                      >
                        <div className="text-sm">
                          <span className="text-archive">{obj.accession_number}</span>
                          <span className="mx-1">-</span>
                          <span className="text-ink">{obj.title || 'Untitled'}</span>
                        </div>
                        <span className="text-xs text-semantic-error">{obj.reason}</span>
                      </div>
                    ))}
                  </div>
                  <label htmlFor="bulk-action-skip-blocked" className="flex items-center gap-2 mt-2 text-sm">
                    <Checkbox
                      id="bulk-action-skip-blocked"
                      checked={skipBlocked}
                      onChange={(e) => setSkipBlocked(e.target.checked)}
                    />
                    Skip blocked objects and continue with allowed
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Step: Execute confirmation */}
          {step === 'execute' && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-bark/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Zap size={32} className="text-bark" />
              </div>
              <h3 className="text-lg font-medium text-ink mb-2">Ready to Execute</h3>
              <p className="text-sm text-archive mb-4">
                {selectedAction?.label} will be applied to{' '}
                {validateData ? validateData.allowed_count : objectCount} objects.
              </p>
              <p className="text-xs text-archive">This action cannot be undone.</p>
            </div>
          )}

          {/* Step: Results */}
          {step === 'results' && executeData && (
            <div>
              <div
                className={cn(
                  'text-center py-6 mb-4 rounded-sm',
                  executeData.status === 'completed'
                    ? 'bg-semantic-success/10'
                    : 'bg-semantic-error/10'
                )}
              >
                {executeData.status === 'completed' ? (
                  <>
                    <Check size={32} className="text-semantic-success mx-auto mb-2" />
                    <h3 className="text-lg font-medium text-ink">Action Completed</h3>
                    <p className="text-sm text-archive">
                      Successfully processed {executeData.success_count} of {executeData.total_count}{' '}
                      objects
                    </p>
                  </>
                ) : (
                  <>
                    <XCircle size={32} className="text-semantic-error mx-auto mb-2" />
                    <h3 className="text-lg font-medium text-ink">Action Failed</h3>
                    <p className="text-sm text-semantic-error">{executeData.error}</p>
                  </>
                )}
              </div>

              <h4 className="text-xs font-medium text-archive uppercase mb-2">Results</h4>
              <div
                role="region"
                aria-label="Results by object"
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable region must take keyboard focus to scroll
                tabIndex={0}
                className="max-h-48 overflow-y-auto border border-lichen rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30"
              >
                {executeData.results.map((result) => (
                  <div
                    key={result.object_id}
                    className="flex items-center justify-between p-2 border-b border-lichen last:border-b-0"
                  >
                    <div className="text-sm">
                      <span className="text-archive">{result.accession_number}</span>
                      {result.reference_number && (
                        <span className="ml-2 text-xs text-bark">{result.reference_number}</span>
                      )}
                    </div>
                    <span
                      className={cn(
                        'text-xs px-2 py-0.5 rounded',
                        result.status === 'success' && 'bg-semantic-success/10 text-semantic-success',
                        result.status === 'error' && 'bg-semantic-error/10 text-semantic-error',
                        result.status === 'skipped' && 'bg-stone text-archive'
                      )}
                    >
                      {result.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen flex justify-between">
          <div>
            {step !== 'select' && step !== 'results' && (
              <button
                onClick={handleBack}
                disabled={isLoading}
                className="px-4 py-2 text-archive hover:text-ink transition-colors flex items-center gap-1 disabled:opacity-50"
              >
                <ChevronLeft size={16} />
                Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-archive hover:text-ink transition-colors"
            >
              {step === 'results' ? 'Close' : 'Cancel'}
            </button>
            {step !== 'select' && step !== 'results' && (
              <>
                {step === 'execute' ? (
                  <button
                    onClick={handleExecute}
                    disabled={isLoading}
                    className="px-4 py-2 bg-bark text-parchment rounded-sm hover:bg-bark/90 transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {executeMutation.isPending ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Executing...
                      </>
                    ) : (
                      <>
                        <Zap size={16} />
                        Execute
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleNext}
                    disabled={isLoading}
                    className="px-4 py-2 bg-bark text-parchment rounded-sm hover:bg-bark/90 transition-colors disabled:opacity-50 flex items-center gap-1"
                  >
                    {isLoading ? (
                      <MadronaLoader variant="dots" />
                    ) : (
                      <>
                        Next
                        <ChevronRight size={16} />
                      </>
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
