import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getConstituent,
  createConstituent,
  updateConstituent,
  deleteConstituent,
  searchUlan,
  getUlanRecord,
  searchViaf,
  searchWikidata,
  searchLoc,
} from '../../../lib/api/constituents';
import type { Constituent, AuthoritySearchResult, UlanRecord, ConstituentSearchResult } from '../../../lib/api/constituents';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import { formatErrorMessage } from '../../../lib/formErrors';
import type { ConstituentFormData } from './types';
import {
  EMPTY_FORM,
  SECTION_GROUPS,
  GROUP_ORDER,
  DEFAULT_SECTION_ORDER,
  INITIAL_EXPANDED_SECTIONS,
  ALL_SECTION_IDS,
  CREATE_MODE_EXCLUDE,
  hydrateForm,
  buildPayload,
} from './types';

// ---------------------------------------------------------------------------
// Data fetching hook
// ---------------------------------------------------------------------------

export function useConstituentData() {
  const { orgId, constituentId } = useParams<{
    orgId: string;
    constituentId?: string;
  }>();

  const isCreateMode = !constituentId;

  const {
    data: constituent,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['constituent', orgId, constituentId],
    queryFn: () => getConstituent(orgId!, constituentId!),
    enabled: !isCreateMode && !!orgId && !!constituentId,
  });

  return {
    orgId,
    constituentId,
    isCreateMode,
    constituent,
    isLoading,
    error,
  };
}

// ---------------------------------------------------------------------------
// Form state and autosave hook
// ---------------------------------------------------------------------------

export function useConstituentFormState(
  constituent: Constituent | undefined,
  isCreateMode: boolean,
  isEditing: boolean,
  orgId: string | undefined,
  constituentId: string | undefined,
  navigate: ReturnType<typeof useNavigate>,
) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<ConstituentFormData>(() => ({ ...EMPTY_FORM }));
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Partial<Constituent>) => createConstituent(orgId!, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['constituents', orgId] });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      navigate(
        `/organizations/${orgId}/collections/constituents/${result.constituent_id}`,
      );
    },
    onError: (err: Error) => {
      setErrorMessage(formatErrorMessage(err.message, 'constituent'));
      setSaveStatus('error');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Partial<Constituent>) =>
      updateConstituent(orgId!, constituentId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['constituent', orgId, constituentId],
      });
      queryClient.invalidateQueries({ queryKey: ['constituents', orgId] });
      if (formData) {
        originalDataRef.current = JSON.stringify(formData);
      }
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      setErrorMessage(null);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
    },
    onError: (err: Error) => {
      setErrorMessage(formatErrorMessage(err.message, 'constituent'));
      setSaveStatus('error');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteConstituent(orgId!, constituentId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['constituents', orgId] });
      navigate(`/organizations/${orgId}/collections/constituents`);
    },
  });

  // Hydrate form from fetched data
  useEffect(() => {
    if (constituent) {
      const data = hydrateForm(constituent);
      setFormData(data);
      originalDataRef.current = JSON.stringify(data);
    }
  }, [constituent]);

  // Update a single field
  const updateField = useCallback(
    (field: keyof ConstituentFormData, value: any) => {
      setFormData((prev) => {
        const next = { ...prev, [field]: value };
        const changed = JSON.stringify(next) !== originalDataRef.current;
        setHasUnsavedChanges(changed);
        return next;
      });
    },
    [],
  );

  // Update place field (updates both the name and TGN ID)
  const updatePlaceField = useCallback(
    (
      placeField: 'birth_place' | 'death_place',
      value: string,
      tgnId: string | null,
    ) => {
      const tgnField =
        placeField === 'birth_place'
          ? 'birth_place_tgn_id'
          : 'death_place_tgn_id';
      setFormData((prev) => {
        const next = { ...prev, [placeField]: value, [tgnField]: tgnId || '' };
        setHasUnsavedChanges(
          JSON.stringify(next) !== originalDataRef.current,
        );
        return next;
      });
    },
    [],
  );

  // Save logic
  const performSave = useCallback(() => {
    setSaveStatus('saving');
    setErrorMessage(null);

    if (!formData.name?.trim()) {
      setErrorMessage('Name is required');
      setSaveStatus('error');
      return;
    }

    const payload = buildPayload(formData);

    if (isCreateMode) {
      createMutation.mutate(payload);
    } else {
      updateMutation.mutate(payload);
    }
  }, [isCreateMode, formData, createMutation, updateMutation]);

  // Autosave on blur
  const handleFieldBlur = useCallback(() => {
    if (!isCreateMode && hasUnsavedChanges && isEditing) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      performSave();
    }
  }, [isCreateMode, hasUnsavedChanges, performSave, isEditing]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  return {
    formData,
    saveStatus,
    errorMessage,
    setErrorMessage,
    lastSaved,
    hasUnsavedChanges,
    updateField,
    updatePlaceField,
    handleFieldBlur,
    performSave,
    deleteMutation,
    queryClient,
  };
}

// ---------------------------------------------------------------------------
// Section state hook
// ---------------------------------------------------------------------------

export function useSectionState(isCreateMode: boolean) {
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const unified = useUnifiedSectionState({
    sectionGroups: SECTION_GROUPS,
    groupOrder: GROUP_ORDER,
    initialExpandedSections: INITIAL_EXPANDED_SECTIONS,
  });

  const {
    expandedSections,
    setExpandedSections,
    raisedSectionId,
    lowerAllSections,
    getSectionOrder: unifiedGetSectionOrder,
  } = unified;

  // Get CSS order value for a section (with fallback to DEFAULT_SECTION_ORDER)
  const getSectionOrder = useCallback(
    (sectionId: string): number => {
      const result = unifiedGetSectionOrder(sectionId);
      if (result !== undefined) return result;

      const groupId = SECTION_GROUPS[sectionId];
      if (!groupId) return 999;
      const groupOffset = GROUP_ORDER.indexOf(groupId) * 100;
      return groupOffset + (DEFAULT_SECTION_ORDER[sectionId] ?? 50);
    },
    [unifiedGetSectionOrder],
  );

  // Section IDs for navigation — derived from config, filtered by mode
  const sectionIds = useMemo(() => {
    if (isCreateMode) {
      return ALL_SECTION_IDS.filter(id => !CREATE_MODE_EXCLUDE.includes(id));
    }
    return [...ALL_SECTION_IDS];
  }, [isCreateMode]);

  // Raise a section — extra params are consumed by index.tsx wrapper for edit mode entry
  const raiseSection = useCallback(
    (
      sectionId: string,
      isEditing: boolean,
      isCreateMode: boolean,
      canEdit: boolean,
      setIsEditing: (v: boolean) => void,
      setSearchParams: (p: any, o?: any) => void,
    ) => {
      unified.handleEnterEditMode(sectionId);

      if (!isEditing && !isCreateMode && canEdit) {
        setIsEditing(true);
        setSearchParams({ mode: 'edit' }, { replace: true });
      }
    },
    [unified],
  );

  // Toggle section (collapse/expand) — accepts a raise callback for compat with index.tsx
  const toggleSection = useCallback(
    (sectionId: string, raiseFn: (id: string) => void) => {
      const isCurrentlyExpanded = expandedSections[sectionId];

      if (isCurrentlyExpanded) {
        setExpandedSections((prev) => ({
          ...prev,
          [sectionId]: false,
        }));
        lowerAllSections();
      } else {
        setExpandedSections((prev) => {
          const newState: Record<string, boolean> = {};
          Object.keys(prev).forEach((key) => {
            newState[key] = key === sectionId;
          });
          return newState;
        });
        raiseFn(sectionId);
      }
    },
    [expandedSections, lowerAllSections, setExpandedSections],
  );

  return {
    expandedSections,
    setExpandedSections,
    raisedSectionId,
    sectionRefs,
    getSectionOrder,
    sectionIds,
    lowerAllSections,
    raiseSection,
    toggleSection,
  };
}

// ---------------------------------------------------------------------------
// Section summaries hook
// ---------------------------------------------------------------------------

export function useSectionSummaries(
  constituent: Constituent | undefined,
  formData: ConstituentFormData,
): Record<string, string | undefined> {
  return useMemo(() => {
    const c = constituent;
    if (!c) return {};

    // Identity: type + name
    const typeLabel =
      (c.constituent_type || 'person').charAt(0).toUpperCase() +
      (c.constituent_type || 'person').slice(1).replace(/_/g, ' ');
    const identity = [typeLabel, c.display_name || c.name]
      .filter(Boolean)
      .join(' \u00b7 ');

    // Contact: email or phone
    const contactParts: string[] = [];
    if (c.email) contactParts.push(c.email);
    if (c.phone) contactParts.push(c.phone);
    if (c.organization_name) contactParts.push(c.organization_name);
    const contact = contactParts.length > 0 ? contactParts.join(' \u00b7 ') : undefined;

    // Biography: birth/death dates
    const bioParts: string[] = [];
    if (c.birth_date_display) bioParts.push(`b. ${c.birth_date_display}`);
    if (c.death_date_display) bioParts.push(`d. ${c.death_date_display}`);
    if (c.nationality) bioParts.push(c.nationality);
    const biography = bioParts.length > 0 ? bioParts.join(' \u00b7 ') : undefined;

    // External IDs: count of linked authorities
    const extParts: string[] = [];
    if (c.ulan_id) extParts.push('ULAN');
    if (c.viaf_id) extParts.push('VIAF');
    if (c.wikidata_id) extParts.push('Wikidata');
    if (c.loc_id) extParts.push('LoC');
    const external =
      extParts.length > 0
        ? `${extParts.length} linked: ${extParts.join(', ')}`
        : undefined;

    // Admin: status
    const admin = c.status
      ? c.status.charAt(0).toUpperCase() + c.status.slice(1)
      : undefined;

    return { identity, contact, biography, external, admin };
  }, [constituent, formData]);
}

// ---------------------------------------------------------------------------
// Has content hook (for empty state detection)
// ---------------------------------------------------------------------------

export function useHasContent(
  constituent: Constituent | undefined,
): Record<string, boolean> {
  return useMemo(() => {
    const c = constituent;
    return {
      identity: true, // always has content (name required)
      contact: !!(
        c?.email ||
        c?.phone ||
        c?.phone_secondary ||
        c?.website ||
        c?.title ||
        c?.role ||
        c?.organization_name ||
        c?.department ||
        c?.address?.street ||
        c?.address?.city
      ),
      biography: !!(
        c?.birth_date_display ||
        c?.death_date_display ||
        c?.biography ||
        c?.active_date_display ||
        c?.birth_place ||
        c?.death_place
      ),
      external: !!(c?.ulan_id || c?.viaf_id || c?.wikidata_id || c?.loc_id),
      admin: true, // always has status
      discussion: true,
      history: true,
    };
  }, [constituent]);
}

// ---------------------------------------------------------------------------
// Authority search hooks
// ---------------------------------------------------------------------------

export function useUlanSearch(
  orgId: string | undefined,
  formData: ConstituentFormData,
  updateField: (field: keyof ConstituentFormData, value: any) => void,
  handleFieldBlur: () => void,
) {
  const [ulanSearchOpen, setUlanSearchOpen] = useState(false);
  const [ulanQuery, setUlanQuery] = useState('');
  const [ulanResults, setUlanResults] = useState<
    Array<{
      id: string;
      source: string;
      label: string;
      description?: string;
      dates?: string;
      nationality?: string;
      ulan_id: string;
      uri?: string;
    }>
  >([]);
  const [ulanSearching, setUlanSearching] = useState(false);
  const [ulanPreview, setUlanPreview] = useState<UlanRecord | null>(null);
  const [ulanLoadingPreview, setUlanLoadingPreview] = useState(false);

  const handleUlanSearch = useCallback(async () => {
    const q = ulanQuery.trim();
    if (q.length < 2 || !orgId) return;
    setUlanSearching(true);
    setUlanPreview(null);
    try {
      const data = await searchUlan(orgId, { q, limit: 15 });
      setUlanResults(
        (data.results || []).filter(
          (r): r is ConstituentSearchResult & { ulan_id: string } => !!r.ulan_id
        )
      );
    } catch {
      setUlanResults([]);
    } finally {
      setUlanSearching(false);
    }
  }, [ulanQuery, orgId]);

  const handleUlanSelect = useCallback(
    async (ulanId: string) => {
      if (!orgId) return;
      setUlanLoadingPreview(true);
      try {
        const record = await getUlanRecord(orgId, ulanId);
        setUlanPreview(record);
      } catch {
        updateField('ulan_id', ulanId);
        handleFieldBlur();
        setUlanSearchOpen(false);
      } finally {
        setUlanLoadingPreview(false);
      }
    },
    [orgId, updateField, handleFieldBlur],
  );

  const handleUlanApply = useCallback(
    (fillFields: boolean) => {
      if (!ulanPreview) return;
      updateField('ulan_id', ulanPreview.ulan_id);
      if (fillFields) {
        if (ulanPreview.display_name) updateField('display_name', ulanPreview.display_name);
        if (ulanPreview.sort_name) updateField('sort_name', ulanPreview.sort_name);
        if (ulanPreview.given_name) updateField('given_name', ulanPreview.given_name);
        if (ulanPreview.family_name) updateField('family_name', ulanPreview.family_name);
        if (ulanPreview.preferred_name && !formData.name)
          updateField('name', ulanPreview.preferred_name);
        if (ulanPreview.variant_names?.length) {
          const merged = [...new Set([...formData.variant_names, ...ulanPreview.variant_names])];
          updateField('variant_names', merged);
        }
        if (ulanPreview.birth_date_display)
          updateField('birth_date_display', ulanPreview.birth_date_display);
        if (ulanPreview.birth_place) updateField('birth_place', ulanPreview.birth_place);
        if (ulanPreview.death_date_display)
          updateField('death_date_display', ulanPreview.death_date_display);
        if (ulanPreview.death_place) updateField('death_place', ulanPreview.death_place);
        if (ulanPreview.nationality) updateField('nationality', ulanPreview.nationality);
        if (ulanPreview.gender) updateField('gender', ulanPreview.gender);
        if (ulanPreview.life_roles?.length) updateField('life_roles', ulanPreview.life_roles);
        if (ulanPreview.biography) updateField('biography', ulanPreview.biography);
      }
      handleFieldBlur();
      setUlanSearchOpen(false);
      setUlanPreview(null);
      setUlanResults([]);
      setUlanQuery('');
    },
    [ulanPreview, formData.variant_names, formData.name, updateField, handleFieldBlur],
  );

  const openUlanSearch = useCallback(() => {
    setUlanQuery(formData.name || formData.display_name || '');
    setUlanResults([]);
    setUlanPreview(null);
    setUlanSearchOpen(true);
  }, [formData.name, formData.display_name]);

  return {
    ulanSearchOpen,
    setUlanSearchOpen,
    ulanQuery,
    setUlanQuery,
    ulanResults,
    ulanSearching,
    ulanPreview,
    setUlanPreview,
    ulanLoadingPreview,
    handleUlanSearch,
    handleUlanSelect,
    handleUlanApply,
    openUlanSearch,
  };
}

export function useAuthoritySearch(
  orgId: string | undefined,
  formData: ConstituentFormData,
  updateField: (field: keyof ConstituentFormData, value: any) => void,
  handleFieldBlur: () => void,
) {
  const [authoritySearchOpen, setAuthoritySearchOpen] = useState<
    'viaf' | 'wikidata' | 'loc' | null
  >(null);
  const [authorityQuery, setAuthorityQuery] = useState('');
  const [authorityResults, setAuthorityResults] = useState<AuthoritySearchResult[]>([]);
  const [authoritySearching, setAuthoritySearching] = useState(false);

  const authoritySearchFns = {
    viaf: searchViaf,
    wikidata: searchWikidata,
    loc: searchLoc,
  };

  const authorityFieldMap = {
    viaf: 'viaf_id' as const,
    wikidata: 'wikidata_id' as const,
    loc: 'loc_id' as const,
  };

  const authorityLabelMap = {
    viaf: 'viaf_label' as const,
    wikidata: 'wikidata_label' as const,
    loc: 'loc_label' as const,
  };

  const handleAuthoritySearch = useCallback(async () => {
    const q = authorityQuery.trim();
    if (q.length < 2 || !orgId || !authoritySearchOpen) return;
    setAuthoritySearching(true);
    try {
      const fn = authoritySearchFns[authoritySearchOpen];
      const data = await fn(orgId, { q, limit: 15 });
      setAuthorityResults(data.results || []);
    } catch {
      setAuthorityResults([]);
    } finally {
      setAuthoritySearching(false);
    }
  }, [authorityQuery, orgId, authoritySearchOpen]);

  const handleAuthoritySelect = useCallback(
    (result: AuthoritySearchResult) => {
      if (!authoritySearchOpen) return;
      const field = authorityFieldMap[authoritySearchOpen];
      const labelField = authorityLabelMap[authoritySearchOpen];
      updateField(field, result.authority_id);
      updateField(labelField, result.label || '');
      handleFieldBlur();
      setAuthoritySearchOpen(null);
      setAuthorityQuery('');
      setAuthorityResults([]);
    },
    [authoritySearchOpen, updateField, handleFieldBlur],
  );

  const openAuthoritySearch = useCallback(
    (type: 'viaf' | 'wikidata' | 'loc') => {
      setAuthorityQuery(formData.name || formData.display_name || '');
      setAuthorityResults([]);
      setAuthoritySearchOpen(type);
    },
    [formData.name, formData.display_name],
  );

  return {
    authoritySearchOpen,
    setAuthoritySearchOpen,
    authorityQuery,
    setAuthorityQuery,
    authorityResults,
    authoritySearching,
    handleAuthoritySearch,
    handleAuthoritySelect,
    openAuthoritySearch,
  };
}
