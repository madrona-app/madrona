import { AlertTriangle, ArrowLeft, RotateCcw, Home } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

interface WorkspaceErrorFallbackProps {
  error?: Error;
  resetError?: () => void;
  /** Custom back URL (otherwise defaults to parent list page) */
  backUrl?: string;
  /** Label for the back button */
  backLabel?: string;
}

/**
 * Error fallback UI for workspace pages.
 * Shows a user-friendly error message with options to go back, reload, or go home.
 * Styled to match the Madrona institutional palette.
 */
export function WorkspaceErrorFallback({
  error,
  resetError,
  backUrl,
  backLabel = 'Go Back',
}: WorkspaceErrorFallbackProps) {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();

  const handleBack = () => {
    if (backUrl) {
      navigate(backUrl);
    } else {
      navigate(-1);
    }
  };

  const handleReload = () => {
    if (resetError) {
      resetError();
    } else {
      window.location.reload();
    }
  };

  const handleHome = () => {
    if (orgId) {
      navigate(`/organizations/${orgId}`);
    } else {
      navigate('/');
    }
  };

  return (
    <div data-testid="error-boundary" className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="max-w-md w-full text-center">
        {/* Error Icon */}
        <div className="mx-auto w-16 h-16 rounded-full bg-semantic-error/10 flex items-center justify-center mb-6">
          <AlertTriangle className="w-8 h-8 text-semantic-error" />
        </div>

        {/* Error Message */}
        <h1 className="text-xl font-medium text-ink mb-3">
          Something went wrong
        </h1>
        <p className="text-archive mb-6">
          We encountered an error loading this page. This might be a temporary issue.
          Try refreshing the page or going back to the previous page.
        </p>

        {/* Dev-only error details */}
        {import.meta.env.DEV && error && (
          <details className="mb-6 text-left p-4 bg-stone/50 rounded-lg border border-lichen">
            <summary className="cursor-pointer text-sm font-medium text-ink mb-2">
              Error Details (dev only)
            </summary>
            <pre className="text-xs text-semantic-error overflow-auto whitespace-pre-wrap font-mono">
              {error.message}
              {error.stack && `\n\n${error.stack}`}
            </pre>
          </details>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={handleBack}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium
                       text-forest border border-forest rounded-lg hover:bg-forest hover:text-parchment
                       transition-colors focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          >
            <ArrowLeft size={16} />
            {backLabel}
          </button>
          <button
            onClick={handleReload}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium
                       text-parchment bg-bark rounded-lg hover:bg-copper-dark
                       transition-colors focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          >
            <RotateCcw size={16} />
            Try Again
          </button>
          <button
            onClick={handleHome}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium
                       text-archive hover:text-ink
                       transition-colors focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
          >
            <Home size={16} />
            Home
          </button>
        </div>
      </div>
    </div>
  );
}

export default WorkspaceErrorFallback;
