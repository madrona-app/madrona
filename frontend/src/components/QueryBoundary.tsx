import type { ReactNode } from 'react';
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { SectionErrorBoundary } from './SectionErrorBoundary';

interface QueryBoundaryProps {
  children: ReactNode;
  /** Section name for error context */
  sectionName?: string;
}

/**
 * Combines React Query's QueryErrorResetBoundary with SectionErrorBoundary.
 *
 * When a query with `throwOnError: true` fails inside this boundary,
 * the SectionErrorBoundary catches the render error. Clicking "Try again"
 * resets the React Query error state so the queries actually re-attempt
 * rather than staying in a failed state.
 *
 * Usage:
 * ```tsx
 * <QueryBoundary sectionName="Object Details">
 *   <ObjectDetailsPanel />
 * </QueryBoundary>
 * ```
 */
export function QueryBoundary({ children, sectionName }: QueryBoundaryProps) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <SectionErrorBoundary sectionName={sectionName} onReset={reset}>
          {children}
        </SectionErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
