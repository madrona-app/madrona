import ConfirmDialog from '../../../components/ConfirmDialog';
import { ContactSelectorSlideOver } from '../../../components/collections/ConstituentSelectorSlideOver';
import { StatusAdvancementDialog } from '../../../components/collections/StatusAdvancementDialog';
import { CreateTaskSlideOver } from '../../../components/work/CreateTaskSlideOver';
import type { UseMutationResult } from '@tanstack/react-query';
import type { LoanInStatus, FormData } from './types';
import type { LoanIn } from '../../../lib/schemas';

interface DialogsProps {
  orgId: string;
  loanId: string | undefined;
  loan: LoanIn | undefined;
  formData: FormData;
  showDeleteConfirm: boolean;
  setShowDeleteConfirm: (show: boolean) => void;
  showLenderSelector: boolean;
  setShowLenderSelector: (show: boolean) => void;
  showAuthorizerSelector: boolean;
  setShowAuthorizerSelector: (show: boolean) => void;
  showCreateTask: boolean;
  setShowCreateTask: (show: boolean) => void;
  statusAdvancementDialog: {
    isOpen: boolean;
    targetStatus: LoanInStatus;
    targetStatusLabel: string;
  };
  setStatusAdvancementDialog: (dialog: {
    isOpen: boolean;
    targetStatus: LoanInStatus;
    targetStatusLabel: string;
  }) => void;
  statusMutation: UseMutationResult<LoanIn, Error, LoanInStatus, unknown>;
  deleteMutation: UseMutationResult<{ success: boolean }, Error, void, unknown>;
  updateField: <K extends keyof FormData>(field: K, value: FormData[K]) => void;
  validateStatusChange: (targetStatus: LoanInStatus) => { valid: boolean; errors: string[]; warnings: string[] };
}

export function LoanDialogs({
  orgId,
  loanId,
  loan,
  formData: _formData,
  showDeleteConfirm,
  setShowDeleteConfirm,
  showLenderSelector,
  setShowLenderSelector,
  showAuthorizerSelector,
  setShowAuthorizerSelector,
  showCreateTask,
  setShowCreateTask,
  statusAdvancementDialog,
  setStatusAdvancementDialog,
  statusMutation,
  deleteMutation,
  updateField,
  validateStatusChange,
}: DialogsProps) {
  return (
    <>
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete Loan Record"
        message={<>Are you sure you want to delete <strong>{loan?.loan_number || 'this loan record'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />

      <ContactSelectorSlideOver
        isOpen={showLenderSelector}
        onClose={() => setShowLenderSelector(false)}
        onSelect={(contactId) => {
          updateField('lender_id', contactId);
          setShowLenderSelector(false);
        }}
        organizationId={orgId}
        title="Select Lender"
        subtitle="Search for an existing contact or create a new one to use as the lender."
      />

      <ContactSelectorSlideOver
        isOpen={showAuthorizerSelector}
        onClose={() => setShowAuthorizerSelector(false)}
        onSelect={(contactId) => {
          updateField('lender_authorizer_id', contactId);
          setShowAuthorizerSelector(false);
        }}
        organizationId={orgId}
        title="Select Authorizer"
        subtitle="Search for an existing contact or create a new one to use as the lender's authorizer."
      />

      {/* Status Advancement Dialog */}
      <StatusAdvancementDialog
        isOpen={statusAdvancementDialog.isOpen}
        onClose={() => setStatusAdvancementDialog({ ...statusAdvancementDialog, isOpen: false })}
        onConfirm={() => {
          statusMutation.mutate(statusAdvancementDialog.targetStatus);
          setStatusAdvancementDialog({ ...statusAdvancementDialog, isOpen: false });
        }}
        currentStatus={loan?.status || 'requested'}
        targetStatus={statusAdvancementDialog.targetStatus}
        targetStatusLabel={statusAdvancementDialog.targetStatusLabel}
        validation={validateStatusChange(statusAdvancementDialog.targetStatus)}
        isLoading={statusMutation.isPending}
      />

      {/* Create Task Slide-over */}
      {orgId && loanId && loan && (
        <CreateTaskSlideOver
          isOpen={showCreateTask}
          onClose={() => setShowCreateTask(false)}
          orgId={orgId}
          initialEntityType="loan_in"
          initialEntityId={loanId}
          initialEntityLabel={loan.loan_number || `Loan ${loanId.slice(0, 8)}`}
        />
      )}
    </>
  );
}
