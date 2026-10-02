/**
 * Madrona branded loading components.
 *
 * Variants:
 *   <MadronaLoader />                  — Primary spinner with leaf icon (page-level)
 *   <MadronaLoader variant="inline" /> — Compact spinner with label (inside cards/buttons)
 *   <MadronaLoader variant="dots" />   — Three-dot pulse (subtle inline)
 *   <MadronaLoader variant="overlay" /> — Semi-transparent backdrop overlay
 *   <MadronaProgressBar value={42} />  — Determinate progress bar
 */

import { type ReactNode } from 'react';

// ── SVG leaf paths (Madroña / Arbutus) ──────────────────────────────
const LEAF_PATH =
  'M12 1C12 1 6 5.5 5.5 12C5 16.5 8 21.5 12 23C16 21.5 19 16.5 18.5 12C18 5.5 12 1 12 1Z';
const VEIN_PATH = 'M12 4L12 20';

function LeafIcon({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
    >
      <path d={LEAF_PATH} className="fill-forest" />
      <path
        d={VEIN_PATH}
        className="stroke-parchment"
        strokeWidth="0.8"
        strokeLinecap="round"
        fill="none"
        opacity={0.5}
      />
    </svg>
  );
}

// ── Spinning ring (shared between variants) ─────────────────────────
function SpinnerRing({
  size = 64,
  strokeWidth = 3,
  trackClass = 'stroke-lichen',
  arcClass = 'stroke-bark',
}: {
  size?: number;
  strokeWidth?: number;
  trackClass?: string;
  arcClass?: string;
}) {
  const r = 28;
  const circumference = 2 * Math.PI * r;
  const arcLen = circumference * 0.33;
  const gapLen = circumference - arcLen;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Track */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        className="absolute inset-0"
      >
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          className={trackClass}
          strokeWidth={strokeWidth}
        />
      </svg>
      {/* Animated arc */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        className="absolute inset-0 animate-madrona-spin"
      >
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          className={arcClass}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${arcLen} ${gapLen}`}
        />
      </svg>
    </div>
  );
}

// ── Public components ───────────────────────────────────────────────

export type LoaderVariant = 'primary' | 'inline' | 'dots' | 'overlay';

interface MadronaLoaderProps {
  /** Visual variant. Default: "primary" */
  variant?: LoaderVariant;
  /** Optional label shown below/beside the spinner */
  label?: string;
  /** Extra wrapper className */
  className?: string;
  /** Dot size in px for "dots" variant. Default: 10 */
  dotSize?: number;
  /** For overlay variant: content rendered behind the overlay */
  children?: ReactNode;
}

export function MadronaLoader({
  variant = 'primary',
  label,
  className = '',
  dotSize = 10,
}: MadronaLoaderProps) {
  if (variant === 'dots') {
    const gap = Math.max(4, Math.round(dotSize * 0.6));
    return (
      <div
        role="status"
        aria-label={label ?? 'Loading'}
        className={`inline-flex flex-col items-center ${className}`}
      >
        <div className="flex items-center justify-center" style={{ gap }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-full bg-bark animate-madrona-pulse"
              style={{
                width: dotSize,
                height: dotSize,
                animationDelay: `${i * 0.2}s`,
              }}
            />
          ))}
        </div>
        {label && (
          <span className="text-sm text-archive tracking-wide mt-3">{label}</span>
        )}
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <div
        role="status"
        aria-label={label ?? 'Loading'}
        className={`inline-flex items-center gap-3 rounded-lg border border-lichen bg-parchment px-5 py-3 shadow-sm ${className}`}
      >
        <SpinnerRing size={18} strokeWidth={5} trackClass="stroke-lichen" arcClass="stroke-forest" />
        {label && (
          <span className="text-sm text-ink tracking-tight">{label}</span>
        )}
      </div>
    );
  }

  if (variant === 'overlay') {
    return (
      <div
        role="status"
        aria-label={label ?? 'Loading'}
        className={`absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-parchment/85 backdrop-blur-[2px] ${className}`}
      >
        <div className="relative">
          <SpinnerRing size={48} />
          <LeafIcon
            size={16}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-50"
          />
        </div>
        {label && (
          <span className="text-sm text-ink tracking-wide">{label}</span>
        )}
      </div>
    );
  }

  // Default: primary (full centered spinner with leaf)
  return (
    <div
      role="status"
      aria-label={label ?? 'Loading'}
      className={`flex flex-col items-center justify-center gap-4 ${className}`}
    >
      <div className="relative">
        <SpinnerRing size={64} />
        <LeafIcon
          size={20}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-60"
        />
      </div>
      {label && (
        <span className="text-sm text-archive tracking-wide">{label}</span>
      )}
    </div>
  );
}

// ── Determinate progress bar ────────────────────────────────────────

interface MadronaProgressBarProps {
  /** Progress 0–100 */
  value: number;
  /** Label shown left of the percentage */
  label?: string;
  className?: string;
}

export function MadronaProgressBar({
  value,
  label,
  className = '',
}: MadronaProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`w-full flex flex-col gap-2.5 ${className}`}
    >
      <div className="h-1.5 rounded-full bg-lichen overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-forest to-bark transition-[width] duration-100 ease-linear"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <div className="flex justify-between">
        {label && (
          <span className="text-xs text-archive">{label}</span>
        )}
        <span className="text-xs text-ink tabular-nums ml-auto">{clamped}%</span>
      </div>
    </div>
  );
}
