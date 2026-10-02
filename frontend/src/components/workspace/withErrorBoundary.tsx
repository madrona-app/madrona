import type { ComponentType, ReactNode } from 'react';
import { ErrorBoundary } from '../ErrorBoundary';
import { WorkspaceErrorFallback } from './WorkspaceErrorFallback';

interface WithErrorBoundaryOptions {
  /** Custom back URL for the error fallback */
  backUrl?: string;
  /** Custom back button label */
  backLabel?: string;
  /** Custom fallback component */
  fallback?: ReactNode;
}

/**
 * Higher-order component that wraps a component with an ErrorBoundary.
 * Uses WorkspaceErrorFallback as the default fallback UI.
 *
 * @example
 * ```tsx
 * export default withErrorBoundary(MyWorkspacePage, {
 *   backUrl: '/organizations/:orgId/collections/objects',
 *   backLabel: 'Back to Objects'
 * });
 * ```
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: ComponentType<P>,
  options: WithErrorBoundaryOptions = {}
) {
  const { backUrl, backLabel, fallback } = options;

  function WithErrorBoundaryWrapper(props: P) {
    return (
      <ErrorBoundary
        fallback={
          fallback ?? (
            <WorkspaceErrorFallback backUrl={backUrl} backLabel={backLabel} />
          )
        }
      >
        <WrappedComponent {...props} />
      </ErrorBoundary>
    );
  }

  // Copy display name for DevTools
  const wrappedName =
    WrappedComponent.displayName || WrappedComponent.name || 'Component';
  WithErrorBoundaryWrapper.displayName = `withErrorBoundary(${wrappedName})`;

  return WithErrorBoundaryWrapper;
}

/**
 * Wrapper component that provides ErrorBoundary with workspace-specific fallback.
 * Use this when you need more control than the HOC provides.
 *
 * @example
 * ```tsx
 * function MyWorkspacePage() {
 *   return (
 *     <WorkspaceErrorBoundary backLabel="Back to List">
 *       <PageContent />
 *     </WorkspaceErrorBoundary>
 *   );
 * }
 * ```
 */
export function WorkspaceErrorBoundary({
  children,
  backUrl,
  backLabel,
  fallback,
}: {
  children: ReactNode;
  backUrl?: string;
  backLabel?: string;
  fallback?: ReactNode;
}) {
  return (
    <ErrorBoundary
      fallback={
        fallback ?? (
          <WorkspaceErrorFallback backUrl={backUrl} backLabel={backLabel} />
        )
      }
    >
      {children}
    </ErrorBoundary>
  );
}

export default withErrorBoundary;
