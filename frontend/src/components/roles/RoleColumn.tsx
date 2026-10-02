import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Info } from 'lucide-react';
import { UserRoleCard, type OrgUser } from './UserRoleCard';

interface Role {
  role_id: string;
  role_key: string;
  display_name: string;
  description?: string | null;
}

// App-specific role capabilities
const APP_ROLE_DESCRIPTIONS: Record<string, Record<string, string[]>> = {
  bridge: {
    registrar: [
      'Create and configure connectors',
      'Build and manage pipelines',
      'Execute pipeline runs',
      'View logs and run history',
    ],
    curator: [
      'View pipeline configurations',
      'Query and export data',
      'View run history and logs',
    ],
    publisher: [
      'Execute pipeline runs',
      'Export data to destinations',
      'View pipeline status',
    ],
    viewer: [
      'View pipelines and connectors',
      'View run history',
    ],
  },
  collections: {
    registrar: [
      'Create and manage collections',
      'Configure collection schemas',
      'Import and transform data',
    ],
    curator: [
      'Search and browse collections',
      'Export collection data',
      'Create saved searches',
    ],
    publisher: [
      'Publish collection records',
      'Manage record visibility',
      'Export for publishing',
    ],
    viewer: [
      'Browse and view collections',
      'View collection records',
    ],
  },
  media: {
    registrar: [
      'Configure media processing',
      'Manage storage settings',
      'Set up derivatives',
    ],
    curator: [
      'Search and browse media',
      'Download media files',
      'View media metadata',
    ],
    publisher: [
      'Upload media files',
      'Publish media assets',
      'Manage media metadata',
    ],
    viewer: [
      'Browse and view media',
      'View thumbnails and previews',
    ],
  },
  reports: {
    registrar: [
      'Configure report data sources',
      'Create report templates',
    ],
    curator: [
      'Create and run reports',
      'Build custom queries',
      'Schedule report runs',
    ],
    publisher: [
      'Publish and share reports',
      'Export report data',
    ],
    viewer: [
      'View published reports',
      'Download report exports',
    ],
  },
};

const APP_LABELS: Record<string, string> = {
  bridge: 'Bridge',
  collections: 'Collections',
  media: 'Media',
  reports: 'Reports',
};

interface RoleColumnProps {
  role: Role;
  users: OrgUser[];
  isOver?: boolean;
  dataTour?: string;
  currentApp?: string;
  enabledApps?: string[];
}

export function RoleColumn({
  role,
  users,
  isOver,
  dataTour,
  currentApp,
  enabledApps = [],
}: RoleColumnProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const { setNodeRef, isOver: isDroppableOver } = useDroppable({
    id: role.role_id,
    data: {
      type: 'column',
      role,
    },
  });

  const highlighted = isOver || isDroppableOver;

  // Get capabilities for current app, or show all enabled apps
  const getCapabilities = () => {
    if (currentApp) {
      // Show capabilities for the current app only
      return APP_ROLE_DESCRIPTIONS[currentApp]?.[role.role_key] || [];
    }
    // If no current app specified, show all enabled apps
    return [];
  };

  const capabilities = getCapabilities();
  const hasTooltipContent = capabilities.length > 0 || (enabledApps.length > 0 && !currentApp);

  return (
    <div
      ref={setNodeRef}
      data-tour={dataTour}
      className={`
        flex flex-col bg-stone rounded-lg border-2 min-h-[400px]
        ${highlighted ? 'border-primary bg-primary-50' : 'border-lichen'}
        transition-colors duration-200
      `}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-lichen bg-parchment rounded-t-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <h3 className="font-medium text-ink">{role.display_name}</h3>
            {hasTooltipContent && (
              <div className="relative">
                <button
                  type="button"
                  onMouseEnter={() => setShowTooltip(true)}
                  onMouseLeave={() => setShowTooltip(false)}
                  onFocus={() => setShowTooltip(true)}
                  onBlur={() => setShowTooltip(false)}
                  className="text-archive hover:text-accessible-gray focus-visible:outline-none"
                  aria-label={`Info about ${role.display_name} role`}
                >
                  <Info size={14} />
                </button>
                {showTooltip && (
                  <div className="absolute z-50 left-0 top-6 w-64 p-3 bg-parchment border border-lichen rounded-lg shadow-lg text-sm">
                    {currentApp ? (
                      // Show capabilities for current app
                      <>
                        <p className="font-medium text-ink mb-2">
                          {APP_LABELS[currentApp]} Capabilities
                        </p>
                        <ul className="text-accessible-gray text-xs space-y-1">
                          {capabilities.map((cap, i) => (
                            <li key={i} className="flex items-start gap-1.5">
                              <span className="text-forest mt-0.5">•</span>
                              <span>{cap}</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      // Show capabilities for all enabled apps
                      <div className="space-y-3">
                        {enabledApps.map((appKey) => {
                          const appCaps = APP_ROLE_DESCRIPTIONS[appKey]?.[role.role_key] || [];
                          if (appCaps.length === 0) return null;
                          return (
                            <div key={appKey}>
                              <p className="font-medium text-ink mb-1">
                                {APP_LABELS[appKey]}
                              </p>
                              <ul className="text-accessible-gray text-xs space-y-0.5">
                                {appCaps.map((cap, i) => (
                                  <li key={i} className="flex items-start gap-1.5">
                                    <span className="text-forest mt-0.5">•</span>
                                    <span>{cap}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <span className="text-sm text-archive bg-stone px-2 py-0.5 rounded-full">
            {users.length}
          </span>
        </div>
      </div>

      {/* User cards */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto">
        <SortableContext
          items={users.map((u) => u.user_id)}
          strategy={verticalListSortingStrategy}
        >
          {users.map((user, index) => (
            <UserRoleCard
              key={user.user_id}
              user={user}
              dataTour={dataTour && index === 0 ? 'user-card' : undefined}
            />
          ))}
        </SortableContext>

        {users.length === 0 && (
          <div className="flex items-center justify-center h-24 text-archive text-sm">
            No users
          </div>
        )}
      </div>
    </div>
  );
}
