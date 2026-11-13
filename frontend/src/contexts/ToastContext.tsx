import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { onApiError } from '../lib/apiClient';

/**
 * Toast notification type
 */
export interface Toast {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  duration?: number; // Auto-dismiss after ms (0 = no auto-dismiss)
  action?: {
    label: string;
    onClick: () => void;
  };
}

/**
 * Toast context value
 */
interface ToastContextValue {
  /** Show a toast notification */
  showToast: (toast: Omit<Toast, 'id'>) => string;
  /** Dismiss a toast by ID */
  dismissToast: (id: string) => void;
  /** Dismiss all toasts */
  dismissAll: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// Module-level registration for global toast access (e.g., from MutationCache onError)
let _globalShowToast: ((toast: Omit<Toast, 'id'>) => string) | null = null;

export function registerGlobalShowToast(fn: typeof _globalShowToast): void {
  _globalShowToast = fn;
}

export function getGlobalShowToast() {
  return _globalShowToast;
}

// Default durations by type (ms)
const DEFAULT_DURATIONS: Record<Toast['type'], number> = {
  info: 5000,
  success: 4000,
  warning: 6000,
  error: 8000,
};

// Icon components by type
const ICONS: Record<Toast['type'], React.FC<{ size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }>> = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle,
};

// Variant classes — full strings so Tailwind's JIT can statically resolve
// them (do NOT build these with template literals). Toasts use opaque
// parchment with a visible semantic border. No transparency.
const TYPE_CLASSES: Record<
  Toast['type'],
  { surface: string; icon: string; action: string }
> = {
  info: {
    surface: 'bg-parchment border-semantic-info',
    icon: 'text-semantic-info',
    action:
      'border-semantic-info text-semantic-info hover:bg-semantic-info/10',
  },
  success: {
    surface: 'bg-parchment border-semantic-success',
    icon: 'text-semantic-success',
    action:
      'border-semantic-success text-semantic-success hover:bg-semantic-success/10',
  },
  warning: {
    surface: 'bg-parchment border-semantic-warning',
    icon: 'text-semantic-warning',
    action:
      'border-semantic-warning text-semantic-warning hover:bg-semantic-warning/10',
  },
  error: {
    surface: 'bg-parchment border-semantic-error',
    icon: 'text-semantic-error',
    action:
      'border-semantic-error text-semantic-error hover:bg-semantic-error/10',
  },
};

/**
 * Individual toast component
 */
function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  // Auto-dismiss pauses while the pointer is over the toast or focus is inside
  // it, so its action and Dismiss buttons stay reachable (WCAG 2.2.1).
  const [isPaused, setIsPaused] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const variant = TYPE_CLASSES[toast.type];
  const Icon = ICONS[toast.type];

  // Define handleDismiss before useEffect that uses it
  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => onDismiss(toast.id), 200);
  }, [onDismiss, toast.id]);

  // Animate in on mount
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);

  // Auto-dismiss timer
  useEffect(() => {
    const duration = toast.duration ?? DEFAULT_DURATIONS[toast.type];
    if (duration > 0 && !isPaused) {
      timeoutRef.current = setTimeout(() => {
        handleDismiss();
      }, duration);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [toast.duration, toast.type, handleDismiss, isPaused]);

  const visible = isVisible && !isExiting;

  // The toast is not itself a live region: it is inserted into one of the
  // persistent regions in ToastContainer, which exist in the DOM before any
  // toast is added (screen readers such as JAWS do not reliably announce a
  // live region that is created together with its content).
  return (
    <div
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsPaused(false);
      }}
      className={[
        'pointer-events-auto flex items-start gap-3',
        'min-w-[320px] max-w-[min(92vw,420px)]',
        'rounded-lg border px-4 py-3 shadow-lg',
        'font-serif',
        'transition-[opacity,transform] duration-200 ease-out',
        visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full',
        variant.surface,
      ].join(' ')}
    >
      <span className={`shrink-0 mt-0.5 ${variant.icon}`}>
        <Icon size={20} aria-hidden="true" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-ink">
          {toast.title}
        </div>
        {toast.message && (
          <div className="mt-1 text-sm text-ink/80 leading-snug">
            {toast.message}
          </div>
        )}
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action!.onClick();
              handleDismiss();
            }}
            className={[
              'mt-2 inline-flex items-center rounded-md border px-3 py-1',
              'text-xs font-medium transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2',
              variant.action,
            ].join(' ')}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={`Dismiss notification: ${toast.title}`}
        className={[
          'shrink-0 -mr-1 -mt-1 rounded p-1',
          'text-archive hover:text-ink hover:bg-ink/5',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2',
          'transition-colors',
        ].join(' ')}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Whether a toast type interrupts (assertive) or waits for a pause (polite). */
function isUrgent(type: Toast['type']) {
  return type === 'error' || type === 'warning';
}

/**
 * Toast container that renders all active toasts
 */
function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  // Always rendered, even when empty, so both live regions are already in the
  // DOM when a toast arrives. Errors and warnings go to the assertive region
  // (role="alert"); success and info go to the polite one (role="status") so a
  // background success toast doesn't cut the user off mid-sentence.
  const urgent = toasts.filter((t) => isUrgent(t.type));
  const routine = toasts.filter((t) => !isUrgent(t.type));
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[9999] flex flex-col gap-2">
      <div role="alert" aria-live="assertive" className="flex flex-col gap-2 empty:hidden">
        {urgent.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </div>
      <div role="status" aria-live="polite" className="flex flex-col gap-2 empty:hidden">
        {routine.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}

/**
 * Toast Provider - Manages toast state and provides context
 */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const generateId = useCallback(() => {
    return `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  // Listen for global API permission errors and show toasts
  useEffect(() => {
    const unsubscribe = onApiError((error) => {
      if (error.status === 403) {
        const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const toast: Toast = {
          id,
          type: 'error',
          title: 'Permission Denied',
          message: error.message || 'You do not have permission to perform this action. Contact your administrator if you need access.',
          duration: 8000,
        };
        setToasts((prev) => [...prev, toast]);
      }
    });
    return unsubscribe;
  }, []);

  const MAX_TOASTS = 5;

  const showToast = useCallback(
    (toastData: Omit<Toast, 'id'>) => {
      const id = generateId();
      const toast: Toast = { ...toastData, id };
      setToasts((prev) => [...prev.slice(-(MAX_TOASTS - 1)), toast]);
      return id;
    },
    [generateId]
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  // Dismiss newest toast on Escape — repeated presses clear the stack.
  // Ignored when focus is in an input/textarea/contenteditable so Escape
  // can still cancel form fields and modals owned by other components.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
      }
      setToasts((prev) => {
        if (prev.length === 0) return prev;
        return prev.slice(0, -1);
      });
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Register showToast globally for MutationCache access
  useEffect(() => {
    registerGlobalShowToast(showToast);
    return () => registerGlobalShowToast(null);
  }, [showToast]);

  const value: ToastContextValue = {
    showToast,
    dismissToast,
    dismissAll,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
};

/**
 * Hook to access toast functionality
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
