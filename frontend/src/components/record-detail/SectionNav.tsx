/**
 * SectionNav - Grouped section navigation for record detail pages
 *
 * Features:
 * - Grouped sections (Overview, Description, Relationships, Admin)
 * - Collapsible groups
 * - Scroll-spy active section highlighting
 * - Semantic completeness indicators (leaf-only)
 * - Group warning badges when required sections need attention
 * - Responsive: sidebar on desktop, horizontal on tablet/mobile
 *
 * @see /docs/record-detail-page-redesign.md
 */

import { useCallback, useMemo } from 'react';
import {
  FileText,
  Palette,
  Users,
  Shield,
  ChevronDown,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { scrollToSection } from './useScrollSpy';
import { useNavGroupsExpanded } from './useLayoutPersistence';
import {
  SectionIndicator,
  computeSectionIndicator,
  computeGroupWarningCount,
  type SectionStatus,
} from './SectionIndicator';

// =============================================================================
// TYPES
// =============================================================================

export interface SectionDefinition {
  id: string;
  label: string;
  dataKey: string;
  icon?: LucideIcon;
  /** Field paths that must be filled for "complete" status (supports dot notation) */
  requiredFields?: string[];
  /** If true, empty section triggers required-missing instead of empty */
  isRequired?: boolean;
}

export interface SectionGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  sections: SectionDefinition[];
  defaultExpanded: boolean;
}

// Re-export for consumers
export type { SectionStatus };

export interface SectionNavProps {
  /** Section groups configuration */
  groups: SectionGroup[];
  /** Currently active section ID (from scroll spy) */
  activeSection: string;
  /** Record data for completeness calculation */
  sectionData?: Record<string, unknown>;
  /** Callback when a section is clicked */
  onNavigate?: (sectionId: string) => void;
  /** Whether nav is in collapsed (icon-only) mode */
  isCollapsed?: boolean;
  /** Callback to toggle collapsed state */
  onToggleCollapsed?: () => void;
  /** Display variant */
  variant?: 'sidebar' | 'horizontal';
  /** Page type identifier for persisting expanded state (e.g., 'collection-object') */
  pageType?: string;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// DEFAULT SECTION GROUPS
// =============================================================================

export const DEFAULT_SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: FileText,
    defaultExpanded: true,
    sections: [
      { id: 'identification', label: 'Identification', dataKey: 'identification' },
      { id: 'media', label: 'Media', dataKey: 'media' },
    ],
  },
  {
    id: 'object-details',
    label: 'Object Details',
    icon: Palette,
    defaultExpanded: true,
    sections: [
      { id: 'description', label: 'Description', dataKey: 'description' },
      { id: 'physical', label: 'Physical Description', dataKey: 'physical_description' },
      { id: 'production', label: 'Production', dataKey: 'production' },
      { id: 'stylePeriods', label: 'Styles & Periods', dataKey: 'styles_periods' },
      { id: 'subjects', label: 'Iconographic Subjects', dataKey: 'subjects' },
    ],
  },
  {
    id: 'relationships',
    label: 'Relationships',
    icon: Users,
    defaultExpanded: false,
    sections: [
      { id: 'people', label: 'People', dataKey: 'constituents' },
      { id: 'authorities', label: 'Biographies', dataKey: 'biographies' },
      { id: 'places', label: 'Places', dataKey: 'places' },
      { id: 'relationships', label: 'Related Objects', dataKey: 'related_objects' },
      { id: 'citations', label: 'Citations', dataKey: 'citations' },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    icon: Shield,
    defaultExpanded: false,
    sections: [
      { id: 'condition', label: 'Condition', dataKey: 'condition' },
      {
        id: 'location',
        label: 'Location',
        dataKey: 'location',
        isRequired: true,
        requiredFields: ['current_location_id'],
      },
      { id: 'rights', label: 'Rights', dataKey: 'rights' },
      { id: 'acquisition', label: 'Acquisition', dataKey: 'acquisition' },
      { id: 'valuations', label: 'Valuations', dataKey: 'valuations' },
      { id: 'procedures', label: 'Procedures', dataKey: 'procedures' },
    ],
  },
];

// =============================================================================
// GROUP WARNING BADGE COMPONENT
// =============================================================================

interface GroupWarningBadgeProps {
  count: number;
}

function GroupWarningBadge({ count }: GroupWarningBadgeProps) {
  if (count <= 0) return null;

  return (
    <span
      className="ml-auto text-xs font-medium text-semantic-error"
      title={`${count} required section${count > 1 ? 's' : ''} need${count === 1 ? 's' : ''} attention`}
      aria-label={`${count} warning${count > 1 ? 's' : ''}`}
    >
      {count}⚠
    </span>
  );
}

// =============================================================================
// SECTION ITEM COMPONENT
// =============================================================================

interface SectionItemProps {
  section: SectionDefinition;
  isActive: boolean;
  status: SectionStatus;
  onSectionClick: (id: string) => void;
}

function SectionItem({
  section,
  isActive,
  status,
  onSectionClick,
}: SectionItemProps) {
  return (
    <li>
      <button
        onClick={() => onSectionClick(section.id)}
        className={cn(
          'w-full flex items-center gap-1 px-2 py-1.5 text-sm rounded transition-colors text-left',
          isActive
            ? 'bg-azurite/10 text-azurite font-medium'
            : 'text-ink hover:bg-stone',
          'focus-visible:outline-none focus-visible:underline'
        )}
        aria-current={isActive ? 'true' : undefined}
      >
        <span className="flex-1 truncate">{section.label}</span>
        <SectionIndicator status={status} size="sm" />
      </button>
    </li>
  );
}

// =============================================================================
// SECTION NAV COMPONENT
// =============================================================================

export function SectionNav({
  groups = DEFAULT_SECTION_GROUPS,
  activeSection,
  sectionData = {},
  onNavigate,
  isCollapsed = false,
  onToggleCollapsed,
  variant = 'sidebar',
  pageType = 'default',
  className,
}: SectionNavProps) {
  // Compute default expanded groups from config
  const defaultExpanded = useMemo(() => {
    return groups.filter((g) => g.defaultExpanded).map((g) => g.id);
  }, [groups]);

  // Persisted expanded groups state
  const [expandedGroups, toggleGroupPersisted] = useNavGroupsExpanded(pageType, defaultExpanded);

  // Toggle group expansion (persisted)
  const toggleGroup = useCallback((groupId: string) => {
    toggleGroupPersisted(groupId);
  }, [toggleGroupPersisted]);

  // Handle section click
  const handleSectionClick = useCallback(
    (sectionId: string) => {
      scrollToSection(sectionId, 16);
      onNavigate?.(sectionId);
    },
    [onNavigate]
  );

  // Compute completeness status for all sections
  const statusMap = useMemo(() => {
    const map = new Map<string, SectionStatus>();
    groups.forEach((group) => {
      group.sections.forEach((section) => {
        const data = sectionData[section.dataKey];
        const status = computeSectionIndicator(data, {
          isRequired: section.isRequired,
          requiredFields: section.requiredFields,
        });
        map.set(section.id, status);
      });
    });
    return map;
  }, [groups, sectionData]);

  // Compute warning counts per group
  const groupWarningCounts = useMemo(() => {
    const counts = new Map<string, number>();
    groups.forEach((group) => {
      const groupStatuses = new Map<string, SectionStatus>();
      group.sections.forEach((section) => {
        const status = statusMap.get(section.id);
        if (status) groupStatuses.set(section.id, status);
      });
      counts.set(group.id, computeGroupWarningCount(groupStatuses));
    });
    return counts;
  }, [groups, statusMap]);

  // Horizontal variant for tablet/mobile
  if (variant === 'horizontal') {
    return (
      <nav
        className={cn('flex items-center gap-1 overflow-x-auto', className)}
        aria-label="Record sections"
      >
        {groups.map((group) => (
          <div key={group.id} className="flex items-center">
            <button
              onClick={() => {
                // Find first section in group and navigate
                const firstSection = group.sections[0];
                if (firstSection) handleSectionClick(firstSection.id);
              }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2',
                group.sections.some((s) => s.id === activeSection)
                  ? 'bg-azurite/10 text-azurite'
                  : 'text-archive hover:text-ink hover:bg-stone'
              )}
            >
              <group.icon size={16} />
              {group.label}
            </button>
          </div>
        ))}
      </nav>
    );
  }

  // Sidebar variant (default)
  return (
    <nav
      className={cn(
        'flex flex-col gap-1',
        isCollapsed && 'items-center',
        className
      )}
      aria-label="Record sections"
    >
      {/* Section groups */}
      <ul className="list-none p-0 m-0 space-y-1">
        {groups.map((group) => {
          const isExpanded = expandedGroups.has(group.id);
          const hasActiveSection = group.sections.some((s) => s.id === activeSection);
          const GroupIcon = group.icon;
          const warningCount = groupWarningCounts.get(group.id) || 0;

          return (
            <li key={group.id}>
              {/* Group header - NO indicators on group headers */}
              <button
                onClick={() => toggleGroup(group.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-2 text-sm font-medium rounded transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2',
                  hasActiveSection ? 'text-azurite' : 'text-ink hover:bg-stone',
                  isCollapsed && 'justify-center'
                )}
                aria-expanded={isExpanded}
                aria-controls={`section-group-${group.id}`}
                title={isCollapsed ? group.label : undefined}
              >
                {isCollapsed ? (
                  <GroupIcon size={20} />
                ) : (
                  <>
                    {isExpanded ? (
                      <ChevronDown size={16} className="text-archive flex-shrink-0" />
                    ) : (
                      <ChevronRight size={16} className="text-archive flex-shrink-0" />
                    )}
                    <GroupIcon size={16} className="flex-shrink-0" />
                    <span className="flex-1 text-left">{group.label}</span>
                    {/* Group warning badge - only shown if warningCount >= 1 */}
                    <GroupWarningBadge count={warningCount} />
                  </>
                )}
              </button>

              {/* Group sections - leaf items with indicators */}
              {isExpanded && !isCollapsed && (
                <ul
                  id={`section-group-${group.id}`}
                  className="ml-4 mt-1 space-y-0.5 border-l border-lichen pl-3 list-none m-0"
                >
                  {group.sections.map((section) => {
                    const isActive = section.id === activeSection;
                    const status = statusMap.get(section.id) || 'empty';

                    return (
                      <SectionItem
                        key={section.id}
                        section={section}
                        isActive={isActive}
                        status={status}
                        onSectionClick={handleSectionClick}
                      />
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {/* Collapse toggle button (for responsive) */}
      {onToggleCollapsed && !isCollapsed && (
        <button
          onClick={onToggleCollapsed}
          className={cn(
            'mt-4 px-2 py-1.5 text-xs text-archive hover:text-ink transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2'
          )}
        >
          Collapse navigation
        </button>
      )}
    </nav>
  );
}

export default SectionNav;
