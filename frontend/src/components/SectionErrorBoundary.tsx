import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { logger } from '../lib/logger';

interface Props {
  children: ReactNode;
  /** Section name for error reporting */
  sectionName?: string;
  /** Optional custom fallback UI */
  fallback?: ReactNode;
  /** Callback when error occurs */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Callback when user clicks retry — use to reset external state (e.g. React Query) */
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Section-level error boundary for isolating failures within page sections.
 *
 * Unlike the app-level ErrorBoundary, this component:
 * - Shows a compact inline error UI
 * - Allows retry without full page reload
 * - Reports section context for debugging
 *
 * Usage:
 * ```tsx
 * <SectionErrorBoundary sectionName="Object Details">
 *   <ObjectDetailsPanel />
 * </SectionErrorBoundary>
 * ```
 */
/**
 * A chunk this build no longer has.
 *
 * Vite content-hashes lazy chunks, so after a deploy an already-open tab is
 * running an index that points at filenames the server has replaced. The
 * next lazy route it tries to load 404s and surfaces as a hard error inside
 * whatever boundary caught it — the user sees a broken section for a
 * perfectly healthy app, and the only cure is a reload they have no reason
 * to think of.
 *
 * Browsers word this differently (Chrome "Failed to fetch dynamically
 * imported module", Firefox "error loading dynamically imported module",
 * Safari "Importing a module script failed"), so match loosely.
 */
function isStaleChunkError(error: Error | null | undefined): boolean {
  const text = `${error?.name ?? ''} ${error?.message ?? ''}`.toLowerCase();
  return (
    text.includes('dynamically imported module') ||
    text.includes('importing a module script failed') ||
    text.includes('failed to fetch dynamically')
  );
}

/**
 * Reload at most once a minute.
 *
 * A timestamp rather than a one-shot flag, because both failure modes have
 * to be survivable: if the reload does not fix it (offline, a proxy eating
 * the asset, a genuinely missing file) an unthrottled retry spins forever,
 * while a permanent flag would refuse to reload after the *next* deploy in
 * a long-lived session. A loop would recur within seconds, so a minute is
 * wide enough to break it and short enough to self-heal.
 */
const RELOAD_STAMP = 'madrona_stale_chunk_reload_at';
const RELOAD_COOLDOWN_MS = 60_000;

function reloadOnceForStaleChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_STAMP) ?? 0);
    if (Number.isFinite(last) && Date.now() - last < RELOAD_COOLDOWN_MS) {
      return false;
    }
    sessionStorage.setItem(RELOAD_STAMP, String(Date.now()));
  } catch {
    // Private mode / storage disabled: reloading blind risks a loop.
    return false;
  }
  window.location.reload();
  return true;
}

export class SectionErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { sectionName, onError } = this.props;

    // A deploy landed under this tab. Reload instead of showing an error for
    // an app that is fine; nothing below runs if the reload starts.
    if (isStaleChunkError(error) && reloadOnceForStaleChunk()) {
      return;
    }

    logger.error(
      `SectionErrorBoundary${sectionName ? `: ${sectionName}` : ''} error:`,
      error,
      errorInfo
    );

    if (onError) {
      onError(error, errorInfo);
    }
  }

  private handleRetry = () => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div data-testid="error-boundary" className="rounded-lg border border-semantic-error/20 bg-semantic-error/5 p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-semantic-error/10">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-semantic-error"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>

            <div className="flex-1">
              <h4 className="mb-1 text-sm font-semibold text-semantic-error">
                {this.props.sectionName
                  ? `Error loading ${this.props.sectionName}`
                  : 'Something went wrong'}
              </h4>

              <p className="mb-3 text-[0.8125rem] leading-relaxed text-semantic-error/80">
                This section encountered an error.{' '}
                {import.meta.env.DEV && this.state.error && (
                  <span className="font-mono text-xs">
                    {this.state.error.message}
                  </span>
                )}
              </p>

              <button
                onClick={this.handleRetry}
                className="rounded border border-semantic-error/20 bg-semantic-error/10 px-3 py-1.5 text-[0.8125rem] font-medium text-semantic-error hover:bg-semantic-error/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-error/30 focus-visible:ring-offset-2"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default SectionErrorBoundary;
