import { useState, useCallback, useEffect, useRef } from 'react';
import { useSectionOrder } from '../components/record-detail';

/**
 * Unified section state management for workspace pages.
 *
 * Replaces 4 different useSectionState implementations (Type A/B/C/D)
 * with a single hook that handles section expansion, CSS ordering,
 * raise/lower animations, and optional edit mode integration.
 *
 * @example
 * // Type A (most common — with edit mode):
 * const sections = useUnifiedSectionState({
 *   sectionGroups: SECTION_GROUPS,
 *   groupOrder: GROUP_ORDER,
 *   initialExpandedSections: INITIAL_EXPANDED_SECTIONS,
 *   editMode: {
 *     basePath: `/organizations/${orgId}/collections/loans-in/${loanId}`,
 *     isEditing, setIsEditing, canEdit, isCreateMode,
 *     onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['loan-in', orgId, loanId] }),
 *   },
 * });
 *
 * @example
 * // Type D (always-edit, no toggle — like ObjectEntry):
 * const sections = useUnifiedSectionState({
 *   sectionGroups: SECTION_GROUPS,
 *   groupOrder: GROUP_ORDER,
 *   initialExpandedSections: INITIAL_EXPANDED_SECTIONS,
 * });
 */

export interface SectionGroupDef {
  id: string;
  label: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  defaultExpanded?: boolean;
  sections: Array<{ id: string; label: string; dataKey?: string }>;
}

/**
 * Derive initial expanded sections from section group definitions.
 *
 * Expands sections from groups marked with `defaultExpanded: true`.
 * For the first expanded group, limits to the first N sections.
 * For other expanded groups, expands all sections.
 *
 * @param sectionGroupDefs - The page's section group definitions
 * @param maxInitialExpanded - Max sections to expand from the first expanded group (default: 2)
 */
export function buildInitialExpandedSections(
  sectionGroupDefs: SectionGroupDef[],
  maxInitialExpanded = 2,
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  const firstExpandedGroup = sectionGroupDefs.find(g => g.defaultExpanded);

  for (const group of sectionGroupDefs) {
    for (let i = 0; i < group.sections.length; i++) {
      const section = group.sections[i];
      if (group.defaultExpanded) {
        // First expanded group: limit to maxInitialExpanded sections
        // Other expanded groups: expand all sections
        result[section.id] = group === firstExpandedGroup
          ? i < maxInitialExpanded
          : true;
      } else {
        result[section.id] = false;
      }
    }
  }
  return result;
}

export interface UseUnifiedSectionStateOptions {
  /** Section-to-group mapping, e.g., { info: 'overview', objects: 'details' } */
  sectionGroups: Record<string, string>;

  /** Group ordering for CSS flex order calculation */
  groupOrder: string[];

  /** Which sections start expanded */
  initialExpandedSections: Record<string, boolean>;

  /** Edit mode integration — omit for always-edit pages like ObjectEntry */
  editMode?: {
    basePath: string;
    isEditing: boolean;
    setIsEditing: (editing: boolean) => void;
    canEdit: boolean;
    isCreateMode: boolean;
    /** Called when user saves before exiting edit mode */
    onSaveBeforeExit?: () => void;
    /** Called when toggling OUT of edit mode (e.g., to invalidate queries) */
    onExitEditMode?: () => void;
    /** Whether there are unsaved changes */
    hasUnsavedChanges?: boolean;
  };

  /** Smart auto-expand: expand sections that have data on initial load */
  smartExpand?: {
    data: Record<string, unknown>;
    sectionGroupDefs: SectionGroupDef[];
  };
}

export interface UseUnifiedSectionStateReturn {
  expandedSections: Record<string, boolean>;
  setExpandedSections: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  raisedSectionId: string | null;
  getSectionOrder: (sectionId: string) => number | undefined;
  toggleSection: (sectionId: string) => void;
  handleEnterEditMode: (sectionId: string) => void;
  /** Only present when editMode is provided */
  handleToggleMode: (() => void) | undefined;
  lowerAllSections: () => void;
}

export function useUnifiedSectionState(
  options: UseUnifiedSectionStateOptions
): UseUnifiedSectionStateReturn {
  const {
    sectionGroups,
    groupOrder,
    initialExpandedSections,
    editMode,
    smartExpand,
  } = options;

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(
    () => ({ ...initialExpandedSections })
  );
  const [raisedSectionId, setRaisedSectionId] = useState<string | null>(null);
  const [sectionOrder] = useSectionOrder();
  const smartExpandDone = useRef(false);

  // Smart auto-expand on initial load
  useEffect(() => {
    if (!smartExpand || smartExpandDone.current) return;
    const { data, sectionGroupDefs } = smartExpand;
    if (!data || Object.keys(data).length === 0) return;

    smartExpandDone.current = true;
    const newExpanded: Record<string, boolean> = { ...initialExpandedSections };

    for (const group of sectionGroupDefs) {
      for (const section of group.sections) {
        const dataKey = section.dataKey || section.id;
        const value = data[dataKey];
        const hasData =
          value !== undefined &&
          value !== null &&
          value !== '' &&
          !(Array.isArray(value) && value.length === 0);
        if (hasData) {
          newExpanded[section.id] = true;
        }
      }
    }
    setExpandedSections(newExpanded);
  }, [smartExpand, initialExpandedSections]);

  // Get CSS order value for a section
  const getSectionOrder = useCallback(
    (sectionId: string): number | undefined => {
      const groupId = sectionGroups[sectionId];
      if (!groupId) return undefined;

      const customOrder = sectionOrder[groupId];
      if (!customOrder || customOrder.length === 0) {
        return undefined;
      }

      const index = customOrder.indexOf(sectionId);
      if (index === -1) return undefined;

      const groupIndex = groupOrder.indexOf(groupId);
      return (groupIndex >= 0 ? groupIndex : 99) * 100 + index;
    },
    [sectionGroups, groupOrder, sectionOrder]
  );

  // Lower all raised sections (animation)
  const lowerAllSections = useCallback(() => {
    if (raisedSectionId) {
      const section =
        document.getElementById(`section-${raisedSectionId}`) ||
        document.getElementById(raisedSectionId);
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

  // Raise a section (animation + optional edit mode entry)
  const raiseSection = useCallback(
    (sectionId: string) => {
      // Lower previously raised section
      if (raisedSectionId && raisedSectionId !== sectionId) {
        const prevSection =
          document.getElementById(`section-${raisedSectionId}`) ||
          document.getElementById(raisedSectionId);
        if (prevSection) {
          prevSection.classList.remove('section-raised', 'section-raise-enter');
          prevSection.classList.add('section-raise-exit');
          setTimeout(() => {
            prevSection.classList.remove('section-raise-exit');
          }, 200);
        }
      }

      setRaisedSectionId(sectionId);

      // Raise new section with brief delay for animation
      setTimeout(() => {
        const section =
          document.getElementById(`section-${sectionId}`) ||
          document.getElementById(sectionId);
        if (section) {
          section.classList.remove('section-raise-exit');
          section.classList.add('section-raise-enter', 'section-raised');
          section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 50);

      // Enter edit mode if needed
      if (editMode && !editMode.isEditing && !editMode.isCreateMode && editMode.canEdit) {
        editMode.setIsEditing(true);
        window.history.replaceState(null, '', `${editMode.basePath}/edit`);
      }
    },
    [raisedSectionId, editMode]
  );

  // Toggle section expansion (accordion-style)
  const toggleSection = useCallback(
    (sectionId: string) => {
      const isCurrentlyExpanded = expandedSections[sectionId];

      if (isCurrentlyExpanded) {
        // If not yet editing, enter edit mode instead of collapsing
        if (editMode && !editMode.isEditing && !editMode.isCreateMode && editMode.canEdit) {
          setExpandedSections((prev) => {
            const newState: Record<string, boolean> = {};
            Object.keys(prev).forEach((key) => {
              newState[key] = key === sectionId;
            });
            return newState;
          });
          raiseSection(sectionId);
        } else {
          setExpandedSections((prev) => ({
            ...prev,
            [sectionId]: false,
          }));
          lowerAllSections();
        }
      } else {
        setExpandedSections((prev) => {
          const newState: Record<string, boolean> = {};
          Object.keys(prev).forEach((key) => {
            newState[key] = key === sectionId;
          });
          return newState;
        });
        raiseSection(sectionId);
      }
    },
    [expandedSections, raiseSection, lowerAllSections, editMode]
  );

  // Enter edit mode for a specific section (called from SectionNav)
  const handleEnterEditMode = useCallback(
    (sectionId: string) => {
      setExpandedSections((prev) => {
        const newState: Record<string, boolean> = {};
        Object.keys(prev).forEach((key) => {
          newState[key] = key === sectionId;
        });
        return newState;
      });
      raiseSection(sectionId);
    },
    [raiseSection]
  );

  // Toggle between edit and view mode
  const handleToggleMode = editMode
    ? // eslint-disable-next-line react-hooks/rules-of-hooks
      useCallback(() => {
        const newMode = !editMode.isEditing;
        editMode.setIsEditing(newMode);

        if (!editMode.isCreateMode) {
          const newPath = newMode
            ? `${editMode.basePath}/edit`
            : editMode.basePath;
          window.history.replaceState(null, '', newPath);
        }

        if (!newMode) {
          lowerAllSections();
          editMode.onExitEditMode?.();
        }

        if (!newMode && editMode.hasUnsavedChanges && !editMode.isCreateMode) {
          editMode.onSaveBeforeExit?.();
        }
      }, [editMode, lowerAllSections])
    : undefined;

  return {
    expandedSections,
    setExpandedSections,
    raisedSectionId,
    getSectionOrder,
    toggleSection,
    handleEnterEditMode,
    handleToggleMode,
    lowerAllSections,
  };
}
