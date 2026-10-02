import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getLoanOut, createLoanOut, updateLoanOut, deleteLoanOut, getContact } from '../../../lib/api';
import { apiFetch } from '../../../lib/apiClient';
import { formatErrorMessage } from '../../../lib/formErrors';
import { useUnifiedSectionState, buildInitialExpandedSections } from '../../../hooks/useUnifiedSectionState';
import type { FormData, SaveStatus, ExistingLoan, Contact } from './types';
import { defaultFormData, SECTION_GROUPS, GROUP_ORDER, LOAN_OUT_SECTION_GROUPS, ALL_SECTION_IDS, CREATE_MODE_EXCLUDE } from './constants';

interface UseLoanOutFormProps {
  orgId: string | undefined;
  loanId: string | undefined;
  isCreateMode: boolean;
}

export function useLoanOutForm({ orgId, loanId, isCreateMode }: UseLoanOutFormProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(defaultFormData);

  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formDataRef = useRef<FormData>(formData);

  // Fetch loan data (if editing)
  const { data: existingLoan, isLoading, error } = useQuery<ExistingLoan, Error, ExistingLoan>({
    queryKey: ['loan-out', orgId, loanId],
    queryFn: () => getLoanOut(orgId!, loanId!) as Promise<ExistingLoan>,
    enabled: !isCreateMode && !!orgId && !!loanId,
  });

  // Fetch borrower contact details when borrower_id is set
  const { data: borrowerContact } = useQuery<Contact, Error, Contact>({
    queryKey: ['contact', orgId, formData.borrower_id],
    queryFn: () => getContact(orgId!, formData.borrower_id) as Promise<Contact>,
    enabled: !!orgId && !!formData.borrower_id,
  });

  // Fetch borrower contact person details when borrower_contact_id is set
  const { data: borrowerContactPerson } = useQuery<Contact, Error, Contact>({
    queryKey: ['contact', orgId, formData.borrower_contact_id],
    queryFn: () => getContact(orgId!, formData.borrower_contact_id) as Promise<Contact>,
    enabled: !!orgId && !!formData.borrower_contact_id,
  });

  // Fetch authorizer contact details
  const { data: authorizerContact } = useQuery<Contact, Error, Contact>({
    queryKey: ['contact', orgId, formData.authorizer_id],
    queryFn: () => getContact(orgId!, formData.authorizer_id) as Promise<Contact>,
    enabled: !!orgId && !!formData.authorizer_id,
  });

  // Initialize form data from fetched loan
  useEffect(() => {
    if (existingLoan) {
      const venue = existingLoan.venue_address || {};
      const data: FormData = {
        borrower_id: existingLoan.borrower_id || '',
        borrower_contact_id: existingLoan.borrower_contact_id || '',
        borrower_status: existingLoan.borrower_status || '',
        venue_name: existingLoan.venue_name || '',
        venue_street: venue.street || '',
        venue_city: venue.city || '',
        venue_state: venue.state || '',
        venue_postal_code: venue.postal_code || '',
        venue_country: venue.country || '',
        loan_purpose: existingLoan.loan_purpose || 'exhibition',
        exhibition_title: existingLoan.exhibition_title || '',
        request_date: existingLoan.request_date || new Date().toISOString().split('T')[0],
        loan_start_date: existingLoan.loan_start_date || '',
        loan_end_date: existingLoan.loan_end_date || '',
        loan_conditions: existingLoan.loan_conditions || '',
        special_conditions: existingLoan.special_conditions || '',
        insurance_requirements: existingLoan.insurance_requirements || '',
        insurance_value_total: existingLoan.insurance_value_total?.toString() || '',
        insurance_currency: existingLoan.insurance_currency || 'USD',
        insurance_coverage_type: existingLoan.insurance_coverage_type || 'wall_to_wall',
        certificate_of_insurance_received: existingLoan.certificate_of_insurance_received || false,
        certificate_of_insurance_date: existingLoan.certificate_of_insurance_date || '',
        facility_report_received: existingLoan.facility_report_received || false,
        facility_report_date: existingLoan.facility_report_date || '',
        facility_report_approved: existingLoan.facility_report_approved || false,
        security_conditions_confirmed: existingLoan.security_conditions_confirmed || false,
        loan_agreement_reference: existingLoan.loan_agreement_reference || '',
        loan_agreement_signed_date: existingLoan.loan_agreement_signed_date || '',
        document_location: existingLoan.document_location || '',
        photography_permitted: existingLoan.photography_permitted ?? null,
        photography_conditions: existingLoan.photography_conditions || '',
        reproduction_rights_note: existingLoan.reproduction_rights_note || '',
        loan_note: existingLoan.loan_note || '',
        authorizer_id: existingLoan.authorizer_id || '',

        authorization_date: existingLoan.authorization_date || '',
        authorization_note: existingLoan.authorization_note || '',
        closing_invoice_sent: existingLoan.closing_invoice_sent || false,
        closing_invoice_date: existingLoan.closing_invoice_date || '',
        closing_invoice_reference: existingLoan.closing_invoice_reference || '',
        closing_invoice_amount: existingLoan.closing_invoice_amount?.toString() || '',
        closing_invoice_currency: existingLoan.closing_invoice_currency || 'USD',
        receipt_acknowledged: existingLoan.receipt_acknowledged || false,
        receipt_acknowledged_date: existingLoan.receipt_acknowledged_date || '',
        receipt_acknowledged_reference: existingLoan.receipt_acknowledged_reference || '',
        conditions_met_confirmed: existingLoan.conditions_met_confirmed || false,
        conditions_met_date: existingLoan.conditions_met_date || '',
        conditions_met_note: existingLoan.conditions_met_note || '',
        closing_note: existingLoan.closing_note || '',
      };
      setFormData(data);
      formDataRef.current = data;
      originalDataRef.current = JSON.stringify(data);
    }
  }, [existingLoan]);

  // Prepare payload for API
  const preparePayload = useCallback((data: FormData) => {
    const venue_address = {
      street: data.venue_street || null,
      city: data.venue_city || null,
      state: data.venue_state || null,
      postal_code: data.venue_postal_code || null,
      country: data.venue_country || null,
    };

    return {
      borrower_id: data.borrower_id || null,
      borrower_contact_id: data.borrower_contact_id || null,
      borrower_status: data.borrower_status || null,
      venue_name: data.venue_name || null,
      venue_address: Object.values(venue_address).some(v => v) ? venue_address : null,
      loan_purpose: data.loan_purpose,
      exhibition_title: data.exhibition_title || null,
      request_date: data.request_date || null,
      loan_start_date: data.loan_start_date || null,
      loan_end_date: data.loan_end_date || null,
      loan_conditions: data.loan_conditions || null,
      special_conditions: data.special_conditions || null,
      insurance_requirements: data.insurance_requirements || null,
      insurance_value_total: data.insurance_value_total ? parseFloat(data.insurance_value_total) : null,
      insurance_currency: data.insurance_currency,
      insurance_coverage_type: data.insurance_coverage_type || null,
      certificate_of_insurance_received: data.certificate_of_insurance_received,
      certificate_of_insurance_date: data.certificate_of_insurance_date || null,
      facility_report_received: data.facility_report_received,
      facility_report_date: data.facility_report_date || null,
      facility_report_approved: data.facility_report_approved,
      security_conditions_confirmed: data.security_conditions_confirmed,
      loan_agreement_reference: data.loan_agreement_reference || null,
      loan_agreement_signed_date: data.loan_agreement_signed_date || null,
      document_location: data.document_location || null,
      photography_permitted: data.photography_permitted,
      photography_conditions: data.photography_conditions || null,
      reproduction_rights_note: data.reproduction_rights_note || null,
      loan_note: data.loan_note || null,
      // Authorization
      authorizer_id: data.authorizer_id || null,
      authorization_date: data.authorization_date || null,
      authorization_note: data.authorization_note || null,
      // Closing
      closing_invoice_sent: data.closing_invoice_sent,
      closing_invoice_date: data.closing_invoice_date || null,
      closing_invoice_reference: data.closing_invoice_reference || null,
      closing_invoice_amount: data.closing_invoice_amount ? parseFloat(data.closing_invoice_amount) : null,
      closing_invoice_currency: data.closing_invoice_currency,
      receipt_acknowledged: data.receipt_acknowledged,
      receipt_acknowledged_date: data.receipt_acknowledged_date || null,
      receipt_acknowledged_reference: data.receipt_acknowledged_reference || null,
      conditions_met_confirmed: data.conditions_met_confirmed,
      conditions_met_date: data.conditions_met_date || null,
      conditions_met_note: data.conditions_met_note || null,
      closing_note: data.closing_note || null,
    };
  }, []);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createLoanOut(orgId!, data),
    onSuccess: (result) => {
      setSaveStatus('saved');
      setHasUnsavedChanges(false);
      queryClient.invalidateQueries({ queryKey: ['loans-out', orgId] });
      navigate(`/organizations/${orgId}/collections/loans-out/${result.loan_out_id}`);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'loan_out'));
      setSaveStatus('error');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateLoanOut(orgId!, loanId!, data),
    onSuccess: () => {
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
      queryClient.invalidateQueries({ queryKey: ['loan-out', orgId, loanId] });
      queryClient.invalidateQueries({ queryKey: ['loans-out', orgId] });
      setTimeout(() => setSaveStatus('idle'), 2000);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'loan_out'));
      setSaveStatus('error');
    },
  });

  // Status mutation — uses dedicated /status endpoint (not generic PUT which blocks status changes)
  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      apiFetch(`/organizations/${orgId}/collections/loans-out/${loanId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loan-out', orgId, loanId] });
      queryClient.invalidateQueries({ queryKey: ['loans-out', orgId] });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteLoanOut(orgId!, loanId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loans-out', orgId] });
      navigate(`/organizations/${orgId}/collections/loans-out`);
    },
  });

  // Perform save
  const performSave = useCallback(() => {
    const currentData = formDataRef.current;
    if (!currentData.borrower_id) return;

    setSaveStatus('saving');
    setErrorMessage(null);
    const payload = preparePayload(currentData);

    if (isCreateMode) {
      createMutation.mutate(payload);
    } else {
      updateMutation.mutate(payload);
    }
  }, [isCreateMode, preparePayload, createMutation, updateMutation]);

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

  // Handle field blur for autosave
  const handleFieldBlur = useCallback(() => {
    if (!isCreateMode && hasUnsavedChanges) {
      performSave();
    }
  }, [isCreateMode, hasUnsavedChanges, performSave]);

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
    updateField,
    handleFieldBlur,
    saveStatus,
    lastSaved,
    hasUnsavedChanges,
    errorMessage,
    setErrorMessage,
    existingLoan,
    isLoading,
    error,
    borrowerContact,
    borrowerContactPerson,
    authorizerContact,
    performSave,
    statusMutation,
    deleteMutation,
  };
}

export function useSectionManagement() {
  // Expand first 2 sections from overview group; collapse rest
  const initialExpandedSections = buildInitialExpandedSections(LOAN_OUT_SECTION_GROUPS);

  const unified = useUnifiedSectionState({
    sectionGroups: SECTION_GROUPS,
    groupOrder: GROUP_ORDER,
    initialExpandedSections,
  });

  const {
    expandedSections,
    getSectionOrder,
    lowerAllSections,
  } = unified;

  // Raise a section — returns true if caller should enter edit mode
  const raiseSection = useCallback((sectionId: string, isEditing: boolean, canEdit: boolean, isCreateMode: boolean, orgId: string | undefined, loanId: string | undefined): boolean => {
    unified.handleEnterEditMode(sectionId);

    // Enter edit mode if not already
    if (!isEditing && canEdit) {
      if (!isCreateMode && orgId && loanId) {
        const basePath = `/organizations/${orgId}/collections/loans-out/${loanId}`;
        window.history.replaceState(null, '', `${basePath}/edit`);
      }
      return true;
    }
    return false;
  }, [unified]);

  // Section toggle - accordion behavior, returns true if caller should enter edit mode
  const toggleSection = useCallback((sectionId: string, isEditing: boolean, canEdit: boolean, isCreateMode: boolean, orgId: string | undefined, loanId: string | undefined): boolean => {
    const isCurrentlyExpanded = expandedSections[sectionId];

    if (isCurrentlyExpanded) {
      // If not yet editing, enter edit mode instead of collapsing
      if (!isEditing && canEdit) {
        unified.setExpandedSections(prev => {
          const newState: Record<string, boolean> = {};
          Object.keys(prev).forEach(key => {
            newState[key] = key === sectionId;
          });
          return newState;
        });
        return raiseSection(sectionId, isEditing, canEdit, isCreateMode, orgId, loanId);
      } else {
        // Already editing — collapse
        unified.toggleSection(sectionId);
        return false;
      }
    } else {
      unified.setExpandedSections(prev => {
        const newState: Record<string, boolean> = {};
        Object.keys(prev).forEach(key => {
          newState[key] = key === sectionId;
        });
        return newState;
      });
      return raiseSection(sectionId, isEditing, canEdit, isCreateMode, orgId, loanId);
    }
  }, [expandedSections, raiseSection, unified]);

  // Enter edit mode for a specific section (called from nav)
  const handleEnterEditMode = useCallback((sectionId: string, isEditing: boolean, canEdit: boolean, isCreateMode: boolean, orgId: string | undefined, loanId: string | undefined): boolean => {
    unified.setExpandedSections(prev => {
      const newState: Record<string, boolean> = {};
      Object.keys(prev).forEach(key => {
        newState[key] = key === sectionId;
      });
      return newState;
    });
    return raiseSection(sectionId, isEditing, canEdit, isCreateMode, orgId, loanId);
  }, [raiseSection, unified]);

  return {
    expandedSections,
    raisedSectionId: unified.raisedSectionId,
    getSectionOrder,
    lowerAllSections,
    toggleSection,
    handleEnterEditMode,
  };
}

export function useSectionData(formData: FormData, existingLoan: ExistingLoan | undefined, isCreateMode: boolean) {
  // Section IDs for navigation — derived from config, filtered by mode
  const sectionIds = useMemo(() => {
    if (isCreateMode) {
      return ALL_SECTION_IDS.filter(id => !CREATE_MODE_EXCLUDE.includes(id));
    }
    return [...ALL_SECTION_IDS];
  }, [isCreateMode]);

  // Section data for completeness indicators
  const sectionData = useMemo(() => ({
    borrower: { borrower_id: formData.borrower_id },
    details: { loan_purpose: formData.loan_purpose },
    dates: { loan_start_date: formData.loan_start_date, loan_end_date: formData.loan_end_date },
    authorization: { authorizer_id: formData.authorizer_id, authorization_date: formData.authorization_date },
    insurance: { insurance_value_total: formData.insurance_value_total },
    facility: { facility_report_received: formData.facility_report_received },
    objects: { objects: existingLoan?.objects || [] },
    agreement: { loan_agreement_reference: formData.loan_agreement_reference },
    notes: { loan_note: formData.loan_note },
    renewals: { renewal_count: existingLoan?.renewal_count || 0, max_renewals: existingLoan?.max_renewals || 0 },
  }), [formData, existingLoan?.objects, existingLoan?.renewal_count, existingLoan?.max_renewals]);

  return { sectionIds, sectionData };
}
