import { useState, useCallback } from 'react';
import type { useQueryClient } from '@tanstack/react-query';
import { useSectionOrder } from '../../../components/record-detail';
import { SECTION_GROUPS, GROUP_ORDER, INITIAL_EXPANDED_SECTIONS } from './types';

interface UseSectionStateParams {
  orgId: string | undefined;
  loanId: string | undefined;
  isCreateMode: boolean;
  isEditing: boolean;
  setIsEditing: (editing: boolean) => void;
  canEdit: boolean;
  hasUnsavedChanges: boolean;
  performSave: () => void;
  queryClient: ReturnType<typeof useQueryClient>;
}

export function useSectionState({
  orgId,
  loanId,
  isCreateMode,
  isEditing,
  setIsEditing,
  canEdit,
  hasUnsavedChanges,
  performSave,
  queryClient,
}: UseSectionStateParams) {
  // Section expansion state
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(
    { ...INITIAL_EXPANDED_SECTIONS }
  );

  // Raised section state (for click-to-edit focus)
  const [raisedSectionId, setRaisedSectionId] = useState<string | null>(null);

  // Section order for drag/drop reordering
  const [sectionOrder] = useSectionOrder();

  // Get CSS order value for a section
  const getSectionOrder = useCallback((sectionId: string): number | undefined => {
    const groupId = SECTION_GROUPS[sectionId];
    if (!groupId) return undefined;

    const customOrder = sectionOrder[groupId];
    if (!customOrder || customOrder.length === 0) {
      return undefined;
    }

    const index = customOrder.indexOf(sectionId);
    if (index === -1) return undefined;

    const groupIndex = GROUP_ORDER.indexOf(groupId);
    return (groupIndex >= 0 ? groupIndex : 99) * 100 + index;
  }, [sectionOrder]);

  // Lower all raised sections
  const lowerAllSections = useCallback(() => {
    if (raisedSectionId) {
      const section = document.getElementById(`section-${raisedSectionId}`) || document.getElementById(raisedSectionId);
      if (section) {
        section.classList.remove('section-raised', 'section-raise-enter');
        section.classList.add('section-raise-exit');
        setTimeout(() => {
          section.classList.remove('section-raise-exit');
        }, 200);
      }
      setRaisedSectionId(null);
    }
  }, [raisedSectionId]);

  // Toggle mode
  const handleToggleMode = useCallback(() => {
    const newMode = !isEditing;
    setIsEditing(newMode);

    if (!isCreateMode) {
      const basePath = `/organizations/${orgId}/collections/loans-in/${loanId}`;
      const newPath = newMode ? `${basePath}/edit` : basePath;
      window.history.replaceState(null, '', newPath);
    }

    if (!newMode) {
      lowerAllSections();
      queryClient.invalidateQueries({ queryKey: ['loan-in', orgId, loanId] });
    }

    if (!newMode && hasUnsavedChanges && !isCreateMode) {
      performSave();
    }
  }, [isEditing, isCreateMode, orgId, loanId, hasUnsavedChanges, performSave, lowerAllSections, setIsEditing, queryClient]);

  // Raise a section
  const raiseSection = useCallback((sectionId: string) => {
    if (raisedSectionId && raisedSectionId !== sectionId) {
      const prevSection = document.getElementById(`section-${raisedSectionId}`) || document.getElementById(raisedSectionId);
      if (prevSection) {
        prevSection.classList.remove('section-raised', 'section-raise-enter');
        prevSection.classList.add('section-raise-exit');
        setTimeout(() => {
          prevSection.classList.remove('section-raise-exit');
        }, 200);
      }
    }

    setRaisedSectionId(sectionId);

    setTimeout(() => {
      // The component may have unmounted before this fires (e.g. in tests the
      // jsdom document is torn down) — guard against a ReferenceError.
      if (typeof document === 'undefined') return;
      const section = document.getElementById(`section-${sectionId}`) || document.getElementById(sectionId);
      if (section) {
        section.classList.remove('section-raise-exit');
        section.classList.add('section-raise-enter', 'section-raised');
        section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 50);

    if (!isEditing && !isCreateMode && canEdit) {
      setIsEditing(true);
      const basePath = `/organizations/${orgId}/collections/loans-in/${loanId}`;
      window.history.replaceState(null, '', `${basePath}/edit`);
    }
  }, [raisedSectionId, isEditing, isCreateMode, canEdit, orgId, loanId, setIsEditing]);

  // Section toggle - accordion behavior
  const toggleSection = useCallback((sectionId: string) => {
    const isCurrentlyExpanded = expandedSections[sectionId];

    if (isCurrentlyExpanded) {
      // If not yet editing, enter edit mode instead of collapsing
      if (!isEditing && !isCreateMode && canEdit) {
        setExpandedSections(prev => {
          const newState: Record<string, boolean> = {};
          Object.keys(prev).forEach(key => {
            newState[key] = key === sectionId;
          });
          return newState;
        });
        raiseSection(sectionId);
      } else {
        setExpandedSections(prev => ({
          ...prev,
          [sectionId]: false,
        }));
        lowerAllSections();
      }
    } else {
      setExpandedSections(prev => {
        const newState: Record<string, boolean> = {};
        Object.keys(prev).forEach(key => {
          newState[key] = key === sectionId;
        });
        return newState;
      });
      raiseSection(sectionId);
    }
  }, [expandedSections, raiseSection, lowerAllSections, isEditing, isCreateMode, canEdit]);

  // Enter edit mode for a specific section (called from nav)
  const handleEnterEditMode = useCallback((sectionId: string) => {
    setExpandedSections(prev => {
      const newState: Record<string, boolean> = {};
      Object.keys(prev).forEach(key => {
        newState[key] = key === sectionId;
      });
      return newState;
    });

    raiseSection(sectionId);
  }, [raiseSection]);

  return {
    expandedSections,
    raisedSectionId,
    getSectionOrder,
    toggleSection,
    handleToggleMode,
    handleEnterEditMode,
  };
}
