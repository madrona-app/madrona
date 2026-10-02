import { AlertTriangle, RotateCw, type LucideIcon } from 'lucide-react';

/**
 * ErrorState — the third state primitive alongside <MadronaLoader /> (loading)
 * and <EmptyState /> (empty). Use it wherever a fetch fails, so surfaces stop
 * hand-rolling bare "Could not load…" text with no recovery path.
 *
 * Variants mirror EmptyState:
 *   default  — centered block for full-section failures
 *   compact  — smaller centered block for cards/panels
 *   inline   — single row (icon · message · Retry) for list headers and rails
 *
 * Renders role="alert" so assistive tech announces the failure. When onRetry is
 * provided a "Try again" affordance is shown.
 */
interface ErrorStateProps {
  icon?: LucideIcon;
  /** Default: "Something went wrong" */
  title?: string;
  description?: string;
  /** When provided, shows a retry affordance that calls this. */
  onRetry?: () => void;
  /** Default: "Try again" */
  retryLabel?: string;
  variant?: 'default' | 'compact' | 'inline';
}

export function ErrorState({
  icon: Icon = AlertTriangle,
  title = 'Something went wrong',
  description,
  onRetry,
  retryLabel = 'Try again',
  variant = 'default',
}: ErrorStateProps) {
  if (variant === 'inline') {
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 py-3 px-4 bg-semantic-error/5 border border-semantic-error/20 rounded-institutional"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Icon size={18} className="text-semantic-error shrink-0" aria-hidden />
          <span className="text-sm text-ink truncate">{title}</span>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-sm text-bark hover:text-copper-dark flex items-center gap-1 shrink-0 focus-visible:ring-2 ring-bark/30 ring-offset-2 rounded"
          >
            <RotateCw size={14} aria-hidden />
            {retryLabel}
          </button>
        )}
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div role="alert" className="text-center py-6">
        <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-semantic-error/10 flex items-center justify-center">
          <Icon size={20} className="text-semantic-error" aria-hidden />
        </div>
        <p className="text-sm text-ink mb-1">{title}</p>
        {description && (
          <p className="text-sm text-archive max-w-sm mx-auto mb-2">{description}</p>
        )}
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-sm text-bark hover:text-copper-dark flex items-center gap-1 mx-auto focus-visible:ring-2 ring-bark/30 ring-offset-2 rounded"
          >
            <RotateCw size={14} aria-hidden />
            {retryLabel}
          </button>
        )}
      </div>
    );
  }

  return (
    <div role="alert" className="text-center py-12 px-6">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-semantic-error/10 flex items-center justify-center">
        <Icon size={32} className="text-semantic-error" aria-hidden />
      </div>
      <h3 className="text-lg font-serif font-medium text-forest mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-archive max-w-sm mx-auto mb-4">{description}</p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="btn btn-secondary inline-flex items-center gap-2"
        >
          <RotateCw size={16} aria-hidden />
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export default ErrorState;
