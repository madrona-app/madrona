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

interface BulkActionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  workspaceName: string;
  objectCount: number;
}

type Step = 'select' | 'configure' | 'preview' | 'validate' | 'execute' | 'results';

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

  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
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
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId, descriptionId)}
        onClick={(e) => e.stopPropagation()}
        className="bg-parchment rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col"
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
            <button onClick={onClose} className="p-1 text-archive hover:text-ink rounded">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Progress indicator */}
        <div className="flex items-center gap-1 px-6 py-2 bg-stone/30 border-b border-lichen">
          {(['select', 'configure', 'preview', 'validate', 'execute', 'results'] as Step[]).map(
            (s, idx) => (
              <div key={s} className="flex items-center">
                <div
                  className={cn(
                    'w-2 h-2 rounded-full',
                    step === s
                      ? 'bg-bark'
                      : ['select', 'configure', 'preview', 'validate', 'execute', 'results'].indexOf(
                          step
                        ) > idx
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
            <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm text-sm text-semantic-error flex items-start gap-2">
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
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
                        key={action.key}
                        onClick={() => handleSelectAction(action)}
                        className="w-full flex items-center gap-3 p-4 border border-lichen rounded-sm text-left hover:border-bark/50 hover:bg-bark/5 transition-colors"
                      >
                        <div className="p-2 bg-bark/10 rounded-sm">
                          <Icon size={20} className="text-bark" />
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-ink">{action.label}</div>
                          <div className="text-sm text-archive">{action.description}</div>
                        </div>
                        <ChevronRight size={16} className="text-archive" />
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
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">
                      Destination Location <span className="text-semantic-error">*</span>
                    </label>
                    <LocationPickerButton
                      organizationId={orgId!}
                      value={(actionParams.to_location_id as string) || null}
                      onChange={(locationId) =>
                        setActionParams({ ...actionParams, to_location_id: locationId || '' })
                      }
                      placeholder="Select destination location..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">
                      Reason <span className="text-semantic-error">*</span>
                    </label>
                    <select
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
                    <label className="block text-sm font-medium text-ink mb-1">Note (optional)</label>
                    <textarea
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
                    <label className="block text-sm font-medium text-ink mb-1">
                      Report Type <span className="text-semantic-error">*</span>
                    </label>
                    <select
                      value={(actionParams.report_type as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, report_type: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    >
                      <option value="">Select type...</option>
                      <option value="periodic">Periodic Check</option>
                      <option value="intake">Intake</option>
                      <option value="loan_out">Loan Out</option>
                      <option value="loan_in">Loan In</option>
                      <option value="loan_return">Loan Return</option>
                      <option value="conservation">Conservation</option>
                      <option value="pre_treatment">Pre-Treatment</option>
                      <option value="post_treatment">Post-Treatment</option>
                      <option value="incident">Incident</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">
                      Overall Condition (optional)
                    </label>
                    <select
                      value={(actionParams.overall_condition as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, overall_condition: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    >
                      <option value="">To be determined...</option>
                      <option value="excellent">Excellent</option>
                      <option value="good">Good</option>
                      <option value="fair">Fair</option>
                      <option value="poor">Poor</option>
                      <option value="unacceptable">Unacceptable</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">
                      Summary (optional)
                    </label>
                    <textarea
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
                    <label className="block text-sm font-medium text-ink mb-1">
                      Incident Type <span className="text-semantic-error">*</span>
                    </label>
                    <select
                      value={(actionParams.incident_type as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, incident_type: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    >
                      <option value="">Select type...</option>
                      <option value="damage">Damage</option>
                      <option value="loss">Loss</option>
                      <option value="theft">Theft</option>
                      <option value="vandalism">Vandalism</option>
                      <option value="environmental">Environmental</option>
                      <option value="fire">Fire</option>
                      <option value="water">Water</option>
                      <option value="pest">Pest</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">
                      Description <span className="text-semantic-error">*</span>
                    </label>
                    <textarea
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
                    <label className="block text-sm font-medium text-ink mb-1">
                      Cataloging Status <span className="text-semantic-error">*</span>
                    </label>
                    <select
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
                    <label className="block text-sm font-medium text-ink mb-1">Notes (optional)</label>
                    <textarea
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
                    <label className="block text-sm font-medium text-ink mb-1">
                      Object Status <span className="text-semantic-error">*</span>
                    </label>
                    <select
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
                    <label className="block text-sm font-medium text-ink mb-1">Status Notes (optional)</label>
                    <textarea
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

              {selectedAction.key === 'add_to_loan' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">
                      Loan ID <span className="text-semantic-error">*</span>
                    </label>
                    <input
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
                    <label className="block text-sm font-medium text-ink mb-1">Notes (optional)</label>
                    <textarea
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
                    <label className="block text-sm font-medium text-ink mb-1">
                      Loan Availability <span className="text-semantic-error">*</span>
                    </label>
                    <select
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
                    <label className="block text-sm font-medium text-ink mb-1">Reason (optional)</label>
                    <textarea
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
                    <label className="block text-sm font-medium text-ink mb-1">Review Date (optional)</label>
                    <input
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
                    <label className="block text-sm font-medium text-ink mb-1">
                      Check Type <span className="text-semantic-error">*</span>
                    </label>
                    <select
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
                    <label className="block text-sm font-medium text-ink mb-1">
                      Due Date <span className="text-semantic-error">*</span>
                    </label>
                    <input
                      type="date"
                      value={(actionParams.due_date as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, due_date: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">Priority</label>
                    <select
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
                    <label className="block text-sm font-medium text-ink mb-1">Notes (optional)</label>
                    <textarea
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
                    <label className="block text-sm font-medium text-ink mb-1">
                      Urgency <span className="text-semantic-error">*</span>
                    </label>
                    <select
                      value={(actionParams.urgency as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, urgency: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    >
                      <option value="">Select urgency...</option>
                      <option value="low">Low - Routine attention</option>
                      <option value="medium">Medium - Schedule soon</option>
                      <option value="high">High - Priority attention</option>
                      <option value="critical">Critical - Immediate action needed</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">
                      Concern Type <span className="text-semantic-error">*</span>
                    </label>
                    <select
                      value={(actionParams.concern_type as string) || ''}
                      onChange={(e) =>
                        setActionParams({ ...actionParams, concern_type: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    >
                      <option value="">Select concern type...</option>
                      <option value="structural">Structural Damage</option>
                      <option value="surface">Surface Damage</option>
                      <option value="environmental">Environmental Damage</option>
                      <option value="pest">Pest Damage</option>
                      <option value="deterioration">Active Deterioration</option>
                      <option value="cleaning">Cleaning Required</option>
                      <option value="stabilization">Stabilization Needed</option>
                      <option value="assessment">Assessment Required</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">Description (optional)</label>
                    <textarea
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
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">
                      Handling Requirements <span className="text-semantic-error">*</span>
                    </label>
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
                        <label key={req.value} className="flex items-center gap-2">
                          <Checkbox
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
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1">Additional Notes (optional)</label>
                    <textarea
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
              <div className="max-h-64 overflow-y-auto border border-lichen rounded-sm">
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
                  <div className="max-h-32 overflow-y-auto border border-lichen rounded-sm">
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
                  <label className="flex items-center gap-2 mt-2 text-sm">
                    <Checkbox
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
              <div className="max-h-48 overflow-y-auto border border-lichen rounded-sm">
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
