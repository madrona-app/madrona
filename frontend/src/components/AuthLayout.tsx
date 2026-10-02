import React, { useEffect } from 'react';
import { Wordmark } from './Wordmark';

// Hide the initial HTML loader
const hideInitialLoader = () => {
  const loader = document.getElementById('initial-loader');
  if (loader) {
    loader.classList.add('fade-out');
    setTimeout(() => loader.remove(), 300);
  }
};

interface AuthLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}

/**
 * Shared layout for authentication screens.
 * Uses Madrona institutional design system colors and typography.
 */
export default function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  // Hide initial loader when auth page mounts
  useEffect(() => {
    hideInitialLoader();
  }, []);

  return (
    <div className="min-h-screen bg-stone/40 flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full">
        {/* Madrona wordmark */}
        <div className="text-center mb-8">
          <h1 className="font-serif text-3xl text-forest tracking-wide"><Wordmark /></h1>
        </div>

        {/* Card */}
        <div className="bg-parchment rounded-institutional shadow-archival-md border border-lichen p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <h2 className="font-serif text-2xl text-ink mb-2">{title}</h2>
            {subtitle && <p className="text-archive text-sm">{subtitle}</p>}
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Styled input for auth forms.
 */
export function AuthInput({
  id,
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  required,
  disabled,
  autoComplete,
  autoFocus,
  readOnly,
  maxLength,
  minLength,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  autoComplete?: string;
  autoFocus?: boolean;
  readOnly?: boolean;
  maxLength?: number;
  minLength?: number;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink mb-2">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        className={`w-full px-4 py-2 border border-lichen rounded-institutional focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-transparent transition-colors ${
          readOnly ? 'bg-stone text-archive' : 'bg-parchment'
        }`}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        readOnly={readOnly}
        maxLength={maxLength}
        minLength={minLength}
        aria-label={label}
      />
    </div>
  );
}

/**
 * Primary button for auth forms.
 */
export function AuthButton({
  children,
  type = 'submit',
  disabled,
  onClick,
  variant = 'primary',
}: {
  children: React.ReactNode;
  type?: 'submit' | 'button';
  disabled?: boolean;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
}) {
  const baseClasses =
    'w-full py-2 px-4 rounded-institutional font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';

  const variantClasses =
    variant === 'primary'
      ? 'bg-bark text-parchment hover:bg-bark/90 focus-visible:ring-bark/30 focus-visible:ring-offset-2'
      : 'bg-stone text-ink hover:bg-lichen focus-visible:ring-bark/30 focus-visible:ring-offset-2';

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`${baseClasses} ${variantClasses}`}
    >
      {children}
    </button>
  );
}

/**
 * Link styled for auth forms.
 */
export function AuthLink({
  href,
  children,
  className = '',
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      className={`text-bark hover:text-bark/80 font-medium transition-colors ${className}`}
    >
      {children}
    </a>
  );
}

/**
 * Error message display for auth forms.
 */
export function AuthError({ message }: { message: string }) {
  return (
    <div className="bg-semantic-error/10 border border-semantic-error/30 text-semantic-error px-4 py-3 rounded-institutional text-sm">
      {message}
    </div>
  );
}

/**
 * Success message display for auth forms.
 */
export function AuthSuccess({ message }: { message: string }) {
  return (
    <div className="bg-semantic-success/10 border border-semantic-success/30 text-semantic-success px-4 py-3 rounded-institutional text-sm">
      {message}
    </div>
  );
}

/**
 * Footer links section for auth forms.
 */
export function AuthFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 text-center text-sm text-archive">{children}</div>
  );
}
