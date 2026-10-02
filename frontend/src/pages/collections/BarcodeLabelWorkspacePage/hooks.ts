import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import { apiFetch } from '../../../lib/apiClient';
import { getOrganizationBranding } from '../../../lib/api/admin';
import type { OrganizationBranding } from '../../../lib/api/admin';
import bwipjs from 'bwip-js/browser';
import type { SaveStatus, FormData, BarcodeLabel, EnumsResponse, EntitySearchResult } from './types';
import {
  SECTION_GROUPS,
  GROUP_ORDER,
  INITIAL_EXPANDED_SECTIONS,
  defaultFormData,
  ENTITY_SEARCH_ENDPOINTS,
  BWIP_BCID,
  LABEL_SIZES,
} from './types';

// =============================================================================
// Entity helpers
// =============================================================================

export const getEntityId = (entity: EntitySearchResult, entityType: string): string => {
  if (entityType === 'collection_object') return entity.object_id || '';
  if (entityType === 'location') return entity.location_id || '';
  if (entityType === 'object_part') return entity.part_id || '';
  if (entityType === 'crate') return entity.crate_id || '';
  return '';
};

export const getEntityLabel = (entity: EntitySearchResult, entityType: string): string => {
  if (entityType === 'collection_object') {
    const title = entity.titles?.[0]?.title || entity.title || '';
    return `${entity.object_number || ''}${title ? ` \u2014 ${title}` : ''}`;
  }
  return entity.name || entity.object_number || '';
};

// =============================================================================
// useFormState
// =============================================================================

export function useFormState({
  orgId,
  isCreateMode,
}: {
  orgId: string | undefined;
  isCreateMode: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState<FormData>({ ...defaultFormData });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [entitySearchQuery, setEntitySearchQuery] = useState('');
  const [debouncedEntitySearch, setDebouncedEntitySearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedEntitySearch(entitySearchQuery), 300);
    return () => clearTimeout(timer);
  }, [entitySearchQuery]);

  // Fetch enums
  const { data: enums } = useQuery({
    queryKey: ['barcode-enums', orgId],
    queryFn: () => apiFetch<EnumsResponse>(`/organizations/${orgId}/collections/barcodes/enums`),
    enabled: !!orgId,
  });

  // Entity search
  const endpoint = ENTITY_SEARCH_ENDPOINTS[formData.entity_type];
  const { data: entityResults } = useQuery({
    queryKey: ['entity-search', orgId, formData.entity_type, debouncedEntitySearch],
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedEntitySearch) params.set('q', debouncedEntitySearch);
      params.set('limit', '20');
      // Both /collections/objects and /collections/locations return `items`.
      return apiFetch<{ items?: EntitySearchResult[] }>(
        `/organizations/${orgId}/collections/${endpoint}?${params}`
      );
    },
    enabled: !!orgId && !!endpoint && isCreateMode,
  });

  const entityList = entityResults?.items || [];

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch<BarcodeLabel>(`/organizations/${orgId}/collections/barcodes/labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['barcode-labels'] });
      setLastSaved(new Date());
      setSaveStatus('saved');
      navigate(`/organizations/${orgId}/collections/barcodes/labels/${result.label_id}`);
    },
    onError: (error: Error) => {
      setErrorMessage(error.message || 'Failed to create label');
      setSaveStatus('error');
    },
  });

  const updateField = useCallback((field: keyof FormData, value: string | boolean) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value };
      // Clear entity_id when switching entity_type
      if (field === 'entity_type') {
        next.entity_id = '';
      }
      return next;
    });
  }, []);

  const handleCreate = useCallback(() => {
    if (!formData.entity_id) return;
    setSaveStatus('saving');
    setErrorMessage(null);
    createMutation.mutate({
      entity_type: formData.entity_type,
      entity_id: formData.entity_id,
      barcode_value: formData.auto_generate ? undefined : formData.barcode_value,
      label_format: formData.label_format,
      note: formData.note || undefined,
    });
  }, [formData, createMutation]);

  return {
    formData,
    updateField,
    saveStatus,
    lastSaved,
    errorMessage,
    queryClient,
    handleCreate,
    createMutation,
    enums,
    entitySearchQuery,
    setEntitySearchQuery,
    entityList,
    endpoint,
  };
}

// =============================================================================
// useLabelActions
// =============================================================================

export function useLabelActions({
  orgId,
  labelId,
  label,
}: {
  orgId: string | undefined;
  labelId: string | undefined;
  label: BarcodeLabel | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmAction, setConfirmAction] = useState<'void' | 'delete' | null>(null);
  const [printSize, setPrintSize] = useState<typeof LABEL_SIZES[number]>(LABEL_SIZES[0]);

  // Fetch branding for print labels
  const { data: branding } = useQuery({
    queryKey: ['organization-branding', orgId],
    queryFn: () => getOrganizationBranding(orgId!),
    enabled: !!orgId && !!label,
  });

  // Print mutation
  const printMutation = useMutation({
    mutationFn: () =>
      apiFetch<BarcodeLabel>(`/organizations/${orgId}/collections/barcodes/labels/${labelId}/print`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['barcode-label', orgId, labelId] });
    },
  });

  // Void mutation
  const voidMutation = useMutation({
    mutationFn: () =>
      apiFetch<BarcodeLabel>(`/organizations/${orgId}/collections/barcodes/labels/${labelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'void' }),
      }),
    onSuccess: () => {
      setConfirmAction(null);
      queryClient.invalidateQueries({ queryKey: ['barcode-label', orgId, labelId] });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/organizations/${orgId}/collections/barcodes/labels/${labelId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      setConfirmAction(null);
      queryClient.invalidateQueries({ queryKey: ['barcode-labels'] });
      navigate(`/organizations/${orgId}/collections/barcodes/labels`);
    },
  });

  // Regenerate mutation
  const regenerateMutation = useMutation({
    mutationFn: () =>
      apiFetch<BarcodeLabel>(`/organizations/${orgId}/collections/barcodes/labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity_type: label!.entity_type,
          entity_id: label!.entity_id,
          label_format: label!.label_format,
        }),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['barcode-labels'] });
      navigate(`/organizations/${orgId}/collections/barcodes/labels/${result.label_id}`);
    },
  });

  const handlePrint = useCallback(() => {
    if (!label) return;
    printLabel(label, branding, printSize);
    printMutation.mutate();
  }, [label, branding, printSize, printMutation]);

  return {
    confirmAction,
    setConfirmAction,
    printSize,
    setPrintSize,
    branding,
    printMutation,
    voidMutation,
    deleteMutation,
    regenerateMutation,
    handlePrint,
  };
}

// =============================================================================
// useSectionState
// =============================================================================

export function useSectionState() {
  const {
    expandedSections,
    getSectionOrder,
    toggleSection,
    handleEnterEditMode,
  } = useUnifiedSectionState({
    sectionGroups: SECTION_GROUPS,
    groupOrder: GROUP_ORDER,
    initialExpandedSections: INITIAL_EXPANDED_SECTIONS,
  });

  return {
    expandedSections,
    getSectionOrder,
    toggleSection,
    handleEnterEditMode,
  };
}

// =============================================================================
// useSectionSummaries
// =============================================================================

export function useSectionSummaries(
  formData: FormData,
  label: BarcodeLabel | undefined,
  isCreateMode: boolean,
): Record<string, string | undefined> {
  return useMemo(() => {
    if (isCreateMode) {
      const parts = (items: (string | null | undefined)[]) => items.filter(Boolean).join(' \u00b7 ') || undefined;
      return {
        entity: parts([formData.entity_type, formData.entity_id ? 'Selected' : undefined]),
        format: parts([formData.label_format, formData.auto_generate ? 'Auto' : formData.barcode_value]),
        label: undefined,
        actions: undefined,
      };
    }
    if (label) {
      const parts = (items: (string | null | undefined)[]) => items.filter(Boolean).join(' \u00b7 ') || undefined;
      return {
        entity: parts([label.entity_type_label, label.entity_summary?.object_number || label.entity_summary?.name]),
        format: parts([label.label_format_label, label.barcode_value]),
        label: parts([label.status_label, label.print_count > 0 ? `Printed \u00d7${label.print_count}` : 'Not printed']),
        actions: undefined,
      };
    }
    return { entity: undefined, format: undefined, label: undefined, actions: undefined };
  }, [formData, label, isCreateMode]);
}

// =============================================================================
// useHasContent
// =============================================================================

export function useHasContent(
  formData: FormData,
  label: BarcodeLabel | undefined,
  isCreateMode: boolean,
): Record<string, boolean> {
  return useMemo(() => {
    if (isCreateMode) {
      return {
        entity: !!(formData.entity_type && formData.entity_id),
        format: !!formData.label_format,
        label: false,
        actions: false,
      };
    }
    return {
      entity: !!label?.entity_type,
      format: !!label?.label_format,
      label: !!label,
      actions: !!label,
    };
  }, [formData, label, isCreateMode]);
}

// =============================================================================
// printLabel
// =============================================================================

export function printLabel(
  label: BarcodeLabel,
  branding: OrganizationBranding | undefined,
  size: typeof LABEL_SIZES[number],
) {
  const isMatrix = label.label_format === 'qr' || label.label_format === 'datamatrix';
  const primaryColor = branding?.primary_color || 'rgb(var(--color-forest))';
  const secondaryColor = branding?.secondary_color || 'rgb(var(--color-accessible-gray))';
  const institutionName = branding?.letterhead_name || '';
  const logoUrl = branding?.logo_url || '';
  const footerText = branding?.footer_text || '';
  const accessionNo = label.entity_summary?.object_number || label.entity_summary?.name || label.entity_id;
  const title = label.entity_summary?.title || '';
  const isCompact = size.heightMm <= 30;
  const isSquare = Math.abs(size.widthMm - size.heightMm) < 5;

  const barcodeText = isMatrix && label.public_url ? label.public_url : label.barcode_value;

  // Render barcode to an offscreen canvas and export as data URL
  const offscreen = document.createElement('canvas');
  const bcid = BWIP_BCID[label.label_format] || 'code128';
  try {
    bwipjs.toCanvas(offscreen, {
      bcid,
      text: barcodeText,
      scale: 4,
      height: isMatrix ? 40 : 14,
      ...(isMatrix ? { width: 40 } : {}),
      includetext: !isMatrix,
      textxalign: 'center',
    });
  } catch {
    // Fall back gracefully
  }
  const barcodeDataUrl = offscreen.toDataURL('image/png');

  const printWindow = window.open('', '_blank', 'width=600,height=500');
  if (!printWindow) return;

  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
<title>Print Label \u2014 ${accessionNo}</title>
<style>
  @page {
    size: ${size.widthMm}mm ${size.heightMm}mm;
    margin: 0;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${size.widthMm}mm;
    height: ${size.heightMm}mm;
    font-family: 'Georgia', 'Times New Roman', serif;
    color: #1F1E1B;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .header {
    background: ${primaryColor};
    color: #F3ECDD;
    padding: ${isCompact ? '1mm 2mm' : '2mm 3mm'};
    display: flex;
    align-items: center;
    gap: 2mm;
    flex-shrink: 0;
  }
  .header-logo {
    height: ${isCompact ? '3mm' : '5mm'};
    width: auto;
    object-fit: contain;
  }
  .header-name {
    font-size: ${isCompact ? '5pt' : '6.5pt'};
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .body {
    flex: 1;
    display: flex;
    ${isSquare ? 'flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 2mm;'
      : `flex-direction: row; align-items: center; padding: ${isCompact ? '1mm 2mm' : '2mm 3mm'}; gap: 3mm;`}
    overflow: hidden;
  }
  .info {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .accession {
    font-size: ${isCompact ? '7pt' : '9pt'};
    font-weight: 700;
    letter-spacing: 0.04em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title-line {
    font-size: ${isCompact ? '5pt' : '7pt'};
    font-style: italic;
    color: #6B7A7E;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 0.5mm;
  }
  .barcode-img {
    ${isSquare ? 'max-width: 70%; max-height: 55%; margin-top: 1.5mm;'
      : isMatrix ? 'width: 12mm; height: 12mm; flex-shrink: 0;'
        : `max-height: ${isCompact ? '6mm' : '10mm'}; flex-shrink: 0; max-width: 45%;`}
    object-fit: contain;
  }
  .footer {
    background: ${secondaryColor}12;
    border-top: 0.3mm solid ${secondaryColor}30;
    padding: ${isCompact ? '0.5mm 2mm' : '1mm 3mm'};
    font-size: ${isCompact ? '4pt' : '5pt'};
    color: #6B7A7E;
    display: flex;
    justify-content: space-between;
    flex-shrink: 0;
  }
  @media screen {
    body {
      border: 1px dashed #ccc;
      margin: 10mm auto;
    }
  }
</style>
</head>
<body>
  ${institutionName ? `<div class="header">
    ${logoUrl ? `<img src="${logoUrl}" class="header-logo" crossorigin="anonymous" />` : ''}
    <span class="header-name">${institutionName}</span>
  </div>` : ''}
  <div class="body">
    ${isSquare ? `
      <div class="info">
        <div class="accession">${accessionNo}</div>
        ${title && !isCompact ? `<div class="title-line">${title}</div>` : ''}
      </div>
      <img src="${barcodeDataUrl}" class="barcode-img" />
    ` : `
      <div class="info">
        <div class="accession">${accessionNo}</div>
        ${title && !isCompact ? `<div class="title-line">${title}</div>` : ''}
      </div>
      <img src="${barcodeDataUrl}" class="barcode-img" />
    `}
  </div>
  ${!isCompact && (footerText || label.entity_type_label) ? `<div class="footer">
    <span>${label.entity_type_label}</span>
    <span>${footerText}</span>
  </div>` : ''}
</body>
</html>`);
  printWindow.document.close();

  // Wait for logo image to load before printing
  const images = printWindow.document.querySelectorAll('img');
  let loaded = 0;
  const total = images.length;
  const triggerPrint = () => {
    printWindow.focus();
    printWindow.print();
  };
  if (total === 0) {
    setTimeout(triggerPrint, 100);
  } else {
    images.forEach((img) => {
      img.onload = img.onerror = () => {
        loaded++;
        if (loaded >= total) setTimeout(triggerPrint, 100);
      };
    });
  }
}
