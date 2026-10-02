import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createLoanIn, updateLoanIn, deleteLoanIn, rollbackLoanIn } from '../../../lib/api';
import type { FormData, LoanInStatus, SaveStatus } from './types';
import { defaultFormData } from './types';
import type { LoanIn } from '../../../lib/schemas';

interface UseFormStateParams {
  orgId: string | undefined;
  loanId: string | undefined;
  isCreateMode: boolean;
  entryId: string | null;
  loan: LoanIn | undefined;
}

export function useFormState({
  orgId,
  loanId,
  isCreateMode,
  entryId,
  loan,
}: UseFormStateParams) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Form state
  const [formData, setFormData] = useState<FormData>({ ...defaultFormData });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formDataRef = useRef<FormData>(formData);

  // Initialize form data from fetched loan
  useEffect(() => {
    if (loan) {
      const data: FormData = {
        lender_id: loan.lender_id || '',
        lender_contact_id: loan.lender_contact_id || '',
        loan_purpose: loan.loan_purpose || 'exhibition',
        exhibition_id: loan.exhibition_id || '',
        exhibition_name: loan.exhibition_name || '',
        exhibition_venue: loan.exhibition_venue || '',
        request_date: loan.request_date || '',
        approval_date: loan.approval_date || '',
        loan_start_date: loan.loan_start_date || '',
        loan_end_date: loan.loan_end_date || '',
        loan_conditions: loan.loan_conditions || '',
        special_requirements: loan.special_requirements || '',
        display_requirements: loan.display_requirements || '',
        photography_restrictions: loan.photography_restrictions || '',
        insurance_value: loan.insurance_value?.toString() || '',
        insurance_currency: loan.insurance_currency || 'USD',
        insurance_policy: loan.insurance_policy || '',
        insurance_provider: loan.insurance_provider || '',
        indemnity: loan.indemnity || false,
        indemnity_reference: loan.indemnity_reference || '',
        facility_report_sent: loan.facility_report_sent || false,
        facility_report_date: loan.facility_report_date || '',
        facility_report_approved: loan.facility_report_approved || false,
        facility_report_approved_date: loan.facility_report_approved_date || '',
        facility_report_note: loan.facility_report_note || '',
        shipping_method: loan.shipping_method || '',
        shipping_company: loan.shipping_company || '',
        courier_required: loan.courier_required || false,
        courier_details: loan.courier_details || '',
        crate_required: loan.crate_required || false,
        crate_specifications: loan.crate_specifications || '',
        loan_agreement_reference: loan.loan_agreement_reference || '',
        loan_agreement_date: loan.loan_agreement_date || '',
        loan_agreement_signed_date: loan.loan_agreement_signed_date || '',
        loan_note: loan.loan_note || '',
        internal_note: loan.internal_note || '',
        max_renewals: loan.max_renewals?.toString() || '2',
        lender_authorizer_id: loan.lender_authorizer_id || '',
        lender_authorizer_name: loan.lender_authorizer_name || '',
        lender_authorizer_title: loan.lender_authorizer_title || '',
        lender_authorization_date: loan.lender_authorization_date || '',
        document_location: loan.document_location || '',
        document_location_note: loan.document_location_note || '',
        loan_contact_name: loan.loan_contact_name || '',
        loan_contact_email: loan.loan_contact_email || '',
        loan_contact_phone: loan.loan_contact_phone || '',
        closing_invoice_sent: loan.closing_invoice_sent || false,
        closing_invoice_date: loan.closing_invoice_date || '',
        closing_invoice_reference: loan.closing_invoice_reference || '',
        closing_invoice_amount: loan.closing_invoice_amount?.toString() || '',
        closing_invoice_currency: loan.closing_invoice_currency || '',
        receipt_acknowledged: loan.receipt_acknowledged || false,
        receipt_acknowledged_date: loan.receipt_acknowledged_date || '',
        receipt_acknowledged_reference: loan.receipt_acknowledged_reference || '',
        conditions_met_confirmed: loan.conditions_met_confirmed || false,
        conditions_met_date: loan.conditions_met_date || '',
        conditions_met_note: loan.conditions_met_note || '',
        closing_note: loan.closing_note || '',
      };
      setFormData(data);
      formDataRef.current = data;
      originalDataRef.current = JSON.stringify(data);
    }
  }, [loan]);

  // Prepare payload for API
  const preparePayload = useCallback((data: FormData) => {
    return {
      lender_id: data.lender_id || null,
      loan_purpose: data.loan_purpose,
      exhibition_id: data.exhibition_id || null,
      exhibition_name: data.exhibition_name || null,
      exhibition_venue: data.exhibition_venue || null,
      request_date: data.request_date || null,
      approval_date: data.approval_date || null,
      loan_start_date: data.loan_start_date || null,
      loan_end_date: data.loan_end_date || null,
      loan_conditions: data.loan_conditions || null,
      special_requirements: data.special_requirements || null,
      display_requirements: data.display_requirements || null,
      photography_restrictions: data.photography_restrictions || null,
      insurance_value: data.insurance_value ? parseFloat(data.insurance_value) : null,
      insurance_currency: data.insurance_currency,
      insurance_policy: data.insurance_policy || null,
      insurance_provider: data.insurance_provider || null,
      indemnity: data.indemnity,
      indemnity_reference: data.indemnity_reference || null,
      facility_report_sent: data.facility_report_sent,
      facility_report_date: data.facility_report_date || null,
      facility_report_approved: data.facility_report_approved,
      facility_report_approved_date: data.facility_report_approved_date || null,
      facility_report_note: data.facility_report_note || null,
      shipping_method: data.shipping_method || null,
      shipping_company: data.shipping_company || null,
      courier_required: data.courier_required,
      courier_details: data.courier_details || null,
      crate_required: data.crate_required,
      crate_specifications: data.crate_specifications || null,
      loan_agreement_reference: data.loan_agreement_reference || null,
      loan_agreement_date: data.loan_agreement_date || null,
      loan_agreement_signed_date: data.loan_agreement_signed_date || null,
      loan_note: data.loan_note || null,
      internal_note: data.internal_note || null,
      max_renewals: data.max_renewals ? parseInt(data.max_renewals, 10) : null,
      lender_authorizer_id: data.lender_authorizer_id || null,
      lender_authorizer_name: data.lender_authorizer_name || null,
      lender_authorizer_title: data.lender_authorizer_title || null,
      lender_authorization_date: data.lender_authorization_date || null,
      document_location: data.document_location || null,
      document_location_note: data.document_location_note || null,
      loan_contact_name: data.loan_contact_name || null,
      loan_contact_email: data.loan_contact_email || null,
      loan_contact_phone: data.loan_contact_phone || null,
    };
  }, []);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createLoanIn(orgId!, data),
    onSuccess: (result) => {
      setSaveStatus('saved');
      setHasUnsavedChanges(false);
      queryClient.invalidateQueries({ queryKey: ['loans-in', orgId] });
      if (entryId) {
        queryClient.invalidateQueries({ queryKey: ['object-entry', orgId, entryId] });
      }
      navigate(`/organizations/${orgId}/collections/loans-in/${result.loan_in_id}`);
    },
    onError: () => {
      setSaveStatus('error');
    },
  });

  // Update mutation with optimized cache updates
  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateLoanIn(orgId!, loanId!, data),
    onSuccess: (updatedLoan) => {
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
      queryClient.setQueryData(['loan-in', orgId, loanId], updatedLoan);
      queryClient.invalidateQueries({
        queryKey: ['loans-in', orgId],
        refetchType: 'none',
      });
    },
    onError: () => {
      setSaveStatus('error');
    },
  });

  // Status mutation with optimized cache updates
  const statusMutation = useMutation({
    mutationFn: (status: LoanInStatus) =>
      updateLoanIn(orgId!, loanId!, { status }),
    onSuccess: (updatedLoan) => {
      queryClient.setQueryData(['loan-in', orgId, loanId], updatedLoan);
      queryClient.invalidateQueries({
        queryKey: ['loans-in', orgId],
        refetchType: 'none',
      });
    },
  });

  // Rollback mutation
  const rollbackMutation = useMutation({
    mutationFn: ({ targetStatus, reason }: { targetStatus: string; reason: string }) => rollbackLoanIn(orgId!, loanId!, targetStatus, reason),
    onSuccess: (updatedLoan) => {
      queryClient.setQueryData(['loan-in', orgId, loanId], updatedLoan);
      queryClient.invalidateQueries({
        queryKey: ['loans-in', orgId],
        refetchType: 'none',
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteLoanIn(orgId!, loanId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans-in', orgId] });
      navigate(`/organizations/${orgId}/collections/loans-in`);
    },
  });

  // Perform save
  const performSave = useCallback(() => {
    const currentData = formDataRef.current;
    if (!currentData.lender_id) return;

    setSaveStatus('saving');
    const payload = preparePayload(currentData);

    if (isCreateMode) {
      if (entryId) {
        (payload as Record<string, unknown>).entry_id = entryId;
      }
      createMutation.mutate(payload);
    } else {
      updateMutation.mutate(payload);
    }
  }, [isCreateMode, entryId, preparePayload, createMutation, updateMutation]);

  // Debounced save
  const debouncedSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      if (hasUnsavedChanges && !isCreateMode) {
        performSave();
      }
    }, 1000);
  }, [hasUnsavedChanges, isCreateMode, performSave]);

  // Handle field changes
  const updateField = useCallback(<K extends keyof FormData>(field: K, value: FormData[K]) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value };
      formDataRef.current = next;
      const hasChanges = JSON.stringify(next) !== originalDataRef.current;
      setHasUnsavedChanges(hasChanges);
      return next;
    });
    debouncedSave();
  }, [debouncedSave]);

  // Handle create save
  const handleCreateSave = useCallback(() => {
    if (!formData.lender_id) {
      setErrorMessage('Lender is required');
      return;
    }
    setErrorMessage(null);
    performSave();
  }, [formData.lender_id, performSave]);

  // Warn about unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  return {
    formData,
    setFormData,
    formDataRef,
    hasUnsavedChanges,
    saveStatus,
    lastSaved,
    errorMessage,
    setErrorMessage,
    queryClient,
    createMutation,
    updateMutation,
    statusMutation,
    rollbackMutation,
    deleteMutation,
    updateField,
    performSave,
    handleCreateSave,
  };
}
