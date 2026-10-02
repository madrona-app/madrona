import { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  getLoanIn,
  getContact,
  getExhibition,
  getExhibitions,
  getLoanInObjectEntries,
  getObjectEntryAllMedia,
} from '../../../lib/api';
import { usePermissions } from '../../../hooks/usePermissions';
import {
  LOAN_IN_SECTIONS,
  calculateSectionCompletion,
  validateStatusTransition,
} from '../../../lib/procedureValidation';
import type { LoanInStatus } from './types';
import { useFormState } from './useFormState';
import { useSectionState } from './useSectionState';

export function useLoanInWorkspace() {
  const { orgId, loanId } = useParams<{ orgId: string; loanId?: string }>();
  const [searchParams] = useSearchParams();

  // Determine mode
  const isCreateMode = !loanId;
  const [rawIsEditing, setIsEditing] = useState(true);

  // Permissions
  const { hasPermission } = usePermissions();
  const canEdit = isCreateMode || hasPermission('loans.edit');
  const isEditing = rawIsEditing && canEdit;

  // Pre-population from Object Entry workflow
  const entryId = searchParams.get('entry_id');
  const lenderIdFromEntry = searchParams.get('lender_id');

  // New layout feature flag - enabled by default, disable with ?layout=classic
  const useNewLayout = searchParams.get('layout') !== 'classic' && !isCreateMode;

  // Dialog states
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showLenderSelector, setShowLenderSelector] = useState(false);
  const [showAuthorizerSelector, setShowAuthorizerSelector] = useState(false);
  const [showExhibitionSelector, setShowExhibitionSelector] = useState(false);
  const [exhibitionSearch, setExhibitionSearch] = useState('');
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [statusAdvancementDialog, setStatusAdvancementDialog] = useState<{
    isOpen: boolean;
    targetStatus: LoanInStatus;
    targetStatusLabel: string;
  }>({ isOpen: false, targetStatus: 'requested', targetStatusLabel: '' });

  // Fetch loan data (if editing)
  const { data: loan, isLoading, error } = useQuery({
    queryKey: ['loan-in', orgId, loanId],
    queryFn: () => getLoanIn(orgId!, loanId!),
    enabled: !!orgId && !!loanId && !isCreateMode,
  });

  // Form state hook
  const formState = useFormState({
    orgId,
    loanId,
    isCreateMode,
    entryId,
    loan,
  });

  const {
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
  } = formState;

  // Section state hook
  const sectionState = useSectionState({
    orgId,
    loanId,
    isCreateMode,
    isEditing,
    setIsEditing,
    canEdit,
    hasUnsavedChanges,
    performSave,
    queryClient,
  });

  const {
    expandedSections,
    raisedSectionId,
    getSectionOrder,
    toggleSection,
    handleToggleMode,
    handleEnterEditMode,
  } = sectionState;

  // Fetch lender contact details when lender_id is set
  const { data: lenderContact } = useQuery({
    queryKey: ['contact', orgId, formData.lender_id],
    queryFn: () => getContact(orgId!, formData.lender_id),
    enabled: !!orgId && !!formData.lender_id,
  });

  // Fetch lender contact person details when lender_contact_id is set
  const { data: lenderContactPerson } = useQuery({
    queryKey: ['contact', orgId, formData.lender_contact_id],
    queryFn: () => getContact(orgId!, formData.lender_contact_id),
    enabled: !!orgId && !!formData.lender_contact_id,
  });

  // Fetch authorizer contact details when lender_authorizer_id is set
  const { data: authorizerContact } = useQuery({
    queryKey: ['contact', orgId, formData.lender_authorizer_id],
    queryFn: () => getContact(orgId!, formData.lender_authorizer_id),
    enabled: !!orgId && !!formData.lender_authorizer_id,
  });

  // Fetch exhibition details when exhibition_id is set
  const { data: linkedExhibition } = useQuery({
    queryKey: ['exhibition', orgId, formData.exhibition_id],
    queryFn: () => getExhibition(orgId!, formData.exhibition_id),
    enabled: !!orgId && !!formData.exhibition_id,
  });

  // Search exhibitions for the selector
  const { data: exhibitionSearchResults } = useQuery({
    queryKey: ['exhibitions', orgId, exhibitionSearch],
    queryFn: () => getExhibitions(orgId!, { q: exhibitionSearch, limit: 10 }),
    enabled: !!orgId && showExhibitionSelector,
  });

  // Fetch linked object entries for media display
  const { data: linkedEntries } = useQuery({
    queryKey: ['loan-in-entries', orgId, loanId],
    queryFn: () => getLoanInObjectEntries(orgId!, loanId!),
    enabled: !!orgId && !!loanId && !isCreateMode,
  });

  // Fetch media from all linked entries
  const { data: entryMediaResults } = useQuery({
    queryKey: ['loan-in-entries-media', orgId, linkedEntries?.entries?.map(e => e.entry_id)],
    queryFn: async () => {
      if (!linkedEntries?.entries?.length) return [];
      const mediaPromises = linkedEntries.entries.map(entry =>
        getObjectEntryAllMedia(orgId!, entry.entry_id)
          .then(result => ({ entry, media: result.media }))
          .catch(() => ({ entry, media: [] }))
      );
      const results = await Promise.all(mediaPromises);
      return results
        .map(({ entry, media }) => {
          if (!media?.length) return null;
          const selectedMedia = media.find(m => m.is_primary) || media[0];
          return {
            ...selectedMedia,
            entry_number: entry.entry_number,
            objects_description: entry.objects_description,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);
    },
    enabled: !!orgId && !!linkedEntries?.entries?.length,
  });

  // Transform entry media to the format expected by RecordDetailPageWrapper
  const loanMedia = useMemo(() => {
    if (!entryMediaResults?.length) return [];
    return entryMediaResults.map(m => ({
      media_id: m.media_id,
      url: m.preview_url || m.thumbnail_url || '',
      thumbnail_url: m.thumbnail_url || m.preview_url || '',
      filename: m.filename || '',
      is_primary: m.is_primary,
    }));
  }, [entryMediaResults]);

  // Transform linked entries to entry locations for the right rail
  const entryLocations = useMemo(() => {
    if (!linkedEntries?.entries?.length) return undefined;
    return linkedEntries.entries.map(entry => ({
      entryNumber: entry.entry_number || 'Unknown',
      locationName: entry.location_name || null,
    }));
  }, [linkedEntries]);

  // Pre-populate lender_id from URL params (when creating from Object Entry)
  useEffect(() => {
    if (isCreateMode && lenderIdFromEntry && !formData.lender_id) {
      setFormData(prev => ({ ...prev, lender_id: lenderIdFromEntry }));
      formDataRef.current = { ...formDataRef.current, lender_id: lenderIdFromEntry };
    }
  }, [isCreateMode, lenderIdFromEntry, formData.lender_id, setFormData, formDataRef]);

  // procedure section completion calculations
  const sectionCompletions = useMemo(() => {
    const record: Record<string, unknown> = {
      ...formData,
      loan_number: loan?.loan_number || '',
    };
    return LOAN_IN_SECTIONS.reduce((acc, section) => {
      acc[section.id] = calculateSectionCompletion(section, record);
      return acc;
    }, {} as Record<string, ReturnType<typeof calculateSectionCompletion>>);
  }, [formData, loan?.loan_number]);

  // Build sectionData for nav indicators
  const sectionData = useMemo(() => ({
    linkedEntry: { count: linkedEntries?.entries?.length || 0 },
    linkedExit: { count: 0 },
    lender: { lender_id: formData.lender_id },
    lender_authorization: {
      lender_authorizer_id: formData.lender_authorizer_id,
      lender_authorization_date: formData.lender_authorization_date,
    },
    details: {
      loan_purpose: formData.loan_purpose,
      exhibition_id: formData.loan_purpose === 'exhibition' ? formData.exhibition_id : undefined,
      display_requirements: formData.display_requirements,
      photography_restrictions: formData.photography_restrictions,
    },
    dates: {
      request_date: formData.request_date,
      approval_date: formData.approval_date,
      loan_start_date: formData.loan_start_date,
      loan_end_date: formData.loan_end_date,
    },
    insurance: {
      insurance_value: formData.insurance_value,
      insurance_policy: formData.insurance_policy,
      indemnity: formData.indemnity,
      indemnity_reference: formData.indemnity_reference,
    },
    facility: {
      facility_report_sent: formData.facility_report_sent,
      facility_report_approved: formData.facility_report_approved,
      facility_report_approved_date: formData.facility_report_approved_date,
    },
    shipping: {
      shipping_method: formData.shipping_method,
      shipping_company: formData.shipping_company,
      crate_specifications: formData.crate_specifications,
    },
    agreement: {
      loan_agreement_reference: formData.loan_agreement_reference,
      loan_agreement_date: formData.loan_agreement_date,
      loan_agreement_signed_date: formData.loan_agreement_signed_date,
    },
    document_location: { document_location: formData.document_location },
    loan_contact: {
      loan_contact_name: formData.loan_contact_name,
      loan_contact_email: formData.loan_contact_email,
    },
    notes: {
      loan_note: formData.loan_note,
      internal_note: formData.internal_note,
    },
    condition_reports: {
      condition_report_in_id: loan?.condition_report_in_id,
      condition_report_out_id: loan?.condition_report_out_id,
    },
    renewals: {
      renewal_count: loan?.renewal_count || 0,
      max_renewals: formData.max_renewals,
    },
    discussion: { has_comments: true },
  }), [formData, loan, linkedEntries]);

  // Validate status transition
  const validateStatusChange = (targetStatus: LoanInStatus) => {
    const record: Record<string, unknown> = {
      ...formData,
      loan_number: loan?.loan_number || '',
    };
    return validateStatusTransition('loan_in', targetStatus, record);
  };

  // Handle status advancement with validation
  const handleStatusAdvancement = (targetStatus: LoanInStatus, targetStatusLabel: string) => {
    const validation = validateStatusChange(targetStatus);
    if (validation.valid) {
      statusMutation.mutate(targetStatus);
    } else {
      setStatusAdvancementDialog({
        isOpen: true,
        targetStatus,
        targetStatusLabel,
      });
    }
  };

  // Handle delete
  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  // Calculate days remaining
  const daysRemaining = loan?.loan_end_date
    ? Math.floor((new Date(loan.loan_end_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // Build display title
  const displayTitle = isCreateMode ? 'New Incoming Loan' : 'Incoming Loan';
  const displayNumber = isCreateMode ? '' : (loan?.loan_number || '');

  return {
    // Params and mode
    orgId,
    loanId,
    isCreateMode,
    isEditing,
    canEdit,
    useNewLayout,
    entryId,

    // Data
    loan,
    isLoading,
    error,
    formData,
    lenderContact,
    lenderContactPerson,
    authorizerContact,
    linkedExhibition,
    exhibitionSearchResults,
    linkedEntries,
    loanMedia,
    entryLocations,

    // State
    hasUnsavedChanges,
    saveStatus,
    lastSaved,
    errorMessage,
    setErrorMessage,
    expandedSections,
    raisedSectionId,
    sectionCompletions,
    sectionData,
    daysRemaining,
    displayTitle,
    displayNumber,

    // Dialog states
    showDeleteConfirm,
    setShowDeleteConfirm,
    showLenderSelector,
    setShowLenderSelector,
    showAuthorizerSelector,
    setShowAuthorizerSelector,
    showExhibitionSelector,
    setShowExhibitionSelector,
    exhibitionSearch,
    setExhibitionSearch,
    showCreateTask,
    setShowCreateTask,
    statusAdvancementDialog,
    setStatusAdvancementDialog,

    // Mutations
    createMutation,
    updateMutation,
    statusMutation,
    rollbackMutation,
    deleteMutation,

    // Callbacks
    updateField,
    toggleSection,
    handleToggleMode,
    handleEnterEditMode,
    handleDelete,
    handleCreateSave,
    handleStatusAdvancement,
    validateStatusChange,
    getSectionOrder,
    performSave,
  };
}
