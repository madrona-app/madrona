/**
 * Standard shell for workspace pages — handles loading and error states.
 *
 * Wraps page content in SectionOrderProvider and provides consistent
 * loading skeleton and error display across all workspace pages.
 *
 * @example
 * <WorkspacePageShell
 *   isLoading={isLoading}
 *   error={error}
 *   isCreateMode={isCreateMode}
 *   entityName="Movement"
 *   backUrl={`/organizations/${orgId}/collections/movements`}
 *   icon={ArrowRightLeft}
 * >
 *   <MovementWorkspacePageContent />
 * </WorkspacePageShell>
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SectionOrderProvider } from '../record-detail';

interface WorkspacePageShellProps {
  children: ReactNode;
  /** Show loading state */
  isLoading: boolean;
  /** Fetch error (shows error state) */
  error: unknown;
  /** Whether we're creating a new entity (skip loading/error) */
  isCreateMode: boolean;
  /** Entity display name for error message (e.g., "Movement") */
  entityName: string;
  /** URL to navigate back to list page */
  backUrl: string;
  /** Lucide icon component for error state */
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  /** Existing entity data — if null in view mode, shows "not found" */
  entityData?: unknown;
}

export function WorkspacePageShell({
  children,
  isLoading,
  error,
  isCreateMode,
  entityName,
  backUrl,
  icon: Icon,
  entityData,
}: WorkspacePageShellProps) {
  // Loading state — skeleton that approximates workspace layout
  if (!isCreateMode && isLoading) {
    return (
      <div className="max-w-5xl mx-auto p-6 animate-pulse" aria-busy="true" aria-label={`Loading ${entityName.toLowerCase()}…`}>
        {/* Header skeleton */}
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-stone/50 rounded-institutional h-8 w-8" />
          <div className="bg-stone/50 rounded-institutional h-8 w-2/5" />
        </div>

        {/* Status bar skeleton */}
        <div className="bg-stone/50 rounded-institutional h-10 w-full mb-6" />

        {/* Section skeletons */}
        {[1, 2, 3].map((i) => (
          <div key={i} className="border border-lichen rounded-institutional p-5 mb-4">
            <div className="bg-stone/50 rounded-institutional h-5 w-1/3 mb-4" />
            <div className="space-y-3">
              <div className="bg-stone/50 rounded-institutional h-4 w-full" />
              <div className="bg-stone/50 rounded-institutional h-4 w-4/5" />
              <div className="bg-stone/50 rounded-institutional h-4 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Error state
  if (!isCreateMode && (error || !entityData)) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="text-center py-12">
          {Icon && <Icon size={48} className="mx-auto text-archive mb-4" />}
          <h3 className="text-lg font-serif font-medium text-forest mb-2">
            {entityName} not found
          </h3>
          <p className="text-accessible-gray mb-4">
            {error ? (error as Error).message : `The ${entityName.toLowerCase()} record could not be loaded.`}
          </p>
          <Link to={backUrl} className="text-bark hover:text-copper-dark">
            Back to {entityName}s
          </Link>
        </div>
      </div>
    );
  }

  return (
    <SectionOrderProvider>
      {children}
    </SectionOrderProvider>
  );
}
