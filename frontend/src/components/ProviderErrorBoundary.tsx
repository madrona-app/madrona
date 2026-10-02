/**
 * Provider Error Boundaries
 *
 * Integration guide — after App.tsx is split into app/providers.tsx, wrap providers in tiers:
 *
 * ```tsx
 * // Tier 1 (Infrastructure) — covered by outer ErrorBoundary
 * <ErrorBoundary>
 *   <HelmetProvider>
 *     <QueryClientProvider client={queryClient}>
 *       <ThemeProvider>
 *         <ToastProvider>
 *
 *           // Tier 2 (Auth)
 *           <ProviderErrorBoundary tier="auth">
 *             <AuthProvider>
 *               <MfaChallengeProvider>
 *
 *                 // Tier 3 (App Services)
 *                 <ProviderErrorBoundary tier="services">
 *                   <WebSocketProvider>
 *                     <OrgProvider>
 *                       <WorkProvider>
 *                         {children}
 *                       </WorkProvider>
 *                     </OrgProvider>
 *                   </WebSocketProvider>
 *                 </ProviderErrorBoundary>
 *
 *               </MfaChallengeProvider>
 *             </AuthProvider>
 *           </ProviderErrorBoundary>
 *
 *         </ToastProvider>
 *       </ThemeProvider>
 *     </QueryClientProvider>
 *   </HelmetProvider>
 * </ErrorBoundary>
 * ```
 */

import { Component, type ErrorInfo, type ReactNode, useState } from 'react';
import { logger } from '../lib/logger';

type BoundaryTier = 'auth' | 'services';

interface ProviderErrorBoundaryProps {
  children: ReactNode;
  tier: BoundaryTier;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ProviderErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  dismissed: boolean;
}

// Inline styles as fallback in case Tailwind isn't loaded
const FALLBACK_STYLES = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#E8E4DE', // stone/40 equivalent
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
  },
  card: {
    maxWidth: '28rem',
    width: '100%',
    margin: '1rem',
    padding: '2rem',
    backgroundColor: 'rgb(var(--color-parchment))',
    border: '1px solid #E4DCCB', // lichen
    borderRadius: '0.25rem',
  },
  title: {
    fontSize: '1.25rem',
    fontWeight: 600,
    color: 'rgb(var(--color-ink))', // ink
    marginBottom: '0.75rem',
  },
  message: {
    fontSize: '0.875rem',
    color: 'rgb(var(--color-archive))', // archive
    marginBottom: '1.5rem',
    lineHeight: 1.5,
  },
  buttonRow: {
    display: 'flex',
    gap: '0.75rem',
  },
  primaryButton: {
    padding: '0.5rem 1rem',
    backgroundColor: 'rgb(var(--color-bark))', // bark
    color: 'rgb(var(--color-parchment))', // parchment
    border: 'none',
    borderRadius: '0.25rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: 'pointer',
  },
  secondaryButton: {
    padding: '0.5rem 1rem',
    backgroundColor: 'transparent',
    color: 'rgb(var(--color-forest))', // forest
    border: '1px solid #1F3A2E',
    borderRadius: '0.25rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: 'pointer',
  },
  details: {
    marginTop: '1rem',
    padding: '0.75rem',
    backgroundColor: 'rgb(var(--color-lichen))', // lichen
    borderRadius: '0.25rem',
    fontSize: '0.75rem',
    color: 'rgb(var(--color-archive))', // archive
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    maxHeight: '8rem',
    overflow: 'auto',
  },
};

const TIER_CONFIG: Record<BoundaryTier, { title: string; message: string; allowContinue: boolean }> =
  {
    auth: {
      title: 'Authentication Error',
      message:
        'Something went wrong with authentication. Please reload the page to try again. If the problem persists, try clearing your browser cookies.',
      allowContinue: false,
    },
    services: {
      title: 'Some Features Unavailable',
      message:
        'A background service encountered an error. You can continue using the application with limited functionality, or reload to try again.',
      allowContinue: true,
    },
  };

function ProviderErrorFallback({
  tier,
  error,
  onDismiss,
}: {
  tier: BoundaryTier;
  error: Error | null;
  onDismiss?: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const config = TIER_CONFIG[tier];
  const isDev = import.meta.env.DEV;

  return (
    <div data-testid="error-boundary" style={FALLBACK_STYLES.container} className="flex items-center justify-center min-h-screen bg-stone/40 font-sans">
      <div style={FALLBACK_STYLES.card} className="max-w-md w-full m-4 p-8 bg-parchment border border-lichen rounded-institutional">
        <h1 style={FALLBACK_STYLES.title} className="text-xl font-semibold text-ink mb-3">
          {config.title}
        </h1>
        <p style={FALLBACK_STYLES.message} className="text-sm text-archive mb-6 leading-relaxed">
          {config.message}
        </p>
        <div style={FALLBACK_STYLES.buttonRow} className="flex gap-3">
          <button
            onClick={() => window.location.reload()}
            style={FALLBACK_STYLES.primaryButton}
            className="btn-primary px-4 py-2 text-sm"
          >
            Reload Page
          </button>
          {config.allowContinue && onDismiss && (
            <button
              onClick={onDismiss}
              style={FALLBACK_STYLES.secondaryButton}
              className="btn-secondary px-4 py-2 text-sm"
            >
              Continue in Limited Mode
            </button>
          )}
        </div>
        {isDev && error && (
          <div className="mt-4">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-xs text-archive hover:text-ink underline"
              style={{ fontSize: '0.75rem', color: 'rgb(var(--color-archive))', cursor: 'pointer', background: 'none', border: 'none', textDecoration: 'underline' }}
            >
              {showDetails ? 'Hide' : 'Show'} Error Details
            </button>
            {showDetails && (
              <div style={FALLBACK_STYLES.details} className="mt-2 p-3 bg-lichen rounded-institutional text-xs text-archive font-mono whitespace-pre-wrap break-words max-h-32 overflow-auto">
                {error.message}
                {error.stack && `\n\n${error.stack}`}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

class ProviderErrorBoundary extends Component<ProviderErrorBoundaryProps, ProviderErrorBoundaryState> {
  constructor(props: ProviderErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, dismissed: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ProviderErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error(`ProviderErrorBoundary [${this.props.tier}]:`, error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleDismiss = () => {
    this.setState({ dismissed: true, hasError: false, error: null });
  };

  render() {
    // If the error was dismissed (services tier), try re-rendering children
    if (this.state.dismissed) {
      return this.props.children;
    }

    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ProviderErrorFallback
          tier={this.props.tier}
          error={this.state.error}
          onDismiss={this.props.tier === 'services' ? this.handleDismiss : undefined}
        />
      );
    }

    return this.props.children;
  }
}

export { ProviderErrorBoundary, ProviderErrorFallback };
