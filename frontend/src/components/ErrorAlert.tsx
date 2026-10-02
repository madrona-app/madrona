import { ApiError, getFriendlyErrorMessage } from '../lib/api';

interface ErrorAlertProps {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

export function ErrorAlert({ error, onRetry, className = '' }: ErrorAlertProps) {
  const message = getFriendlyErrorMessage(error);
  const isApiError = error instanceof ApiError;
  const canRetry = isApiError && error.status >= 500;

  return (
    <div
      className={`bg-semantic-error/10 border border-semantic-error/30 rounded-md p-4 ${className}`}
      role="alert"
    >
      <div className="flex">
        <div className="flex-shrink-0">
          <svg
            className="h-5 w-5 text-semantic-error"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-semantic-error">
            {isApiError && error.status > 0 ? `Error (${error.status})` : 'Error'}
          </h3>
          <div className="mt-2 text-sm text-semantic-error">
            <p>{message}</p>
          </div>
          {(canRetry || onRetry) && (
            <div className="mt-4">
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-semantic-error bg-semantic-error/10 hover:bg-semantic-error/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-bark/30"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
