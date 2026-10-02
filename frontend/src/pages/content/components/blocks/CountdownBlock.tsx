/**
 * Countdown Block — Countdown timer to a target date with optional CTA.
 */

import { useState, useEffect, useCallback } from 'react';

// =============================================================================
// Shared Types
// =============================================================================

interface BlockEditorComponentProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

interface BlockRendererComponentProps {
  content: Record<string, unknown>;
}

// =============================================================================
// Editor
// =============================================================================

export function CountdownEditor({ content, onChange }: BlockEditorComponentProps) {
  const targetDate = (content.target_date as string) || '';
  const heading = (content.heading as string) || '';
  const ctaText = (content.cta_text as string) || '';
  const ctaUrl = (content.cta_url as string) || '';

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Target Date <span className="text-semantic-error">*</span>
        </label>
        <input
          type="date"
          value={targetDate}
          onChange={(e) => onChange({ ...content, target_date: e.target.value })}
          className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Heading
        </label>
        <input
          type="text"
          value={heading}
          onChange={(e) => onChange({ ...content, heading: e.target.value })}
          placeholder="e.g., Opening Night"
          className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            CTA Text
          </label>
          <input
            type="text"
            value={ctaText}
            onChange={(e) => onChange({ ...content, cta_text: e.target.value })}
            placeholder="e.g., Get Tickets"
            className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink mb-1">
            CTA URL
          </label>
          <input
            type="text"
            value={ctaUrl}
            onChange={(e) => onChange({ ...content, cta_url: e.target.value })}
            placeholder="e.g., /tickets"
            className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
          />
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function calcTimeLeft(targetDate: string): TimeLeft | null {
  const target = new Date(targetDate + 'T00:00:00').getTime();
  const now = Date.now();
  const diff = target - now;

  if (diff <= 0) return null;

  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / (1000 * 60)) % 60),
    seconds: Math.floor((diff / 1000) % 60),
  };
}

// =============================================================================
// Renderer
// =============================================================================

export function CountdownRenderer({ content }: BlockRendererComponentProps) {
  const targetDate = (content.target_date as string) || '';
  const heading = (content.heading as string) || '';
  const ctaText = (content.cta_text as string) || '';
  const ctaUrl = (content.cta_url as string) || '';

  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(() =>
    targetDate ? calcTimeLeft(targetDate) : null,
  );

  const updateTime = useCallback(() => {
    if (targetDate) {
      setTimeLeft(calcTimeLeft(targetDate));
    }
  }, [targetDate]);

  useEffect(() => {
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [updateTime]);

  if (!targetDate) return null;

  const isPast = timeLeft === null;

  const segments: { label: string; value: number }[] = isPast
    ? []
    : [
        { label: 'Days', value: timeLeft.days },
        { label: 'Hours', value: timeLeft.hours },
        { label: 'Minutes', value: timeLeft.minutes },
        { label: 'Seconds', value: timeLeft.seconds },
      ];

  return (
    <div className="rounded-lg bg-forest px-8 py-10 text-center">
      {heading && (
        <h3 className="text-2xl font-bold text-parchment mb-6">{heading}</h3>
      )}

      {isPast ? (
        <p className="text-lg text-parchment/80">This event has started!</p>
      ) : (
        <div className="flex items-center justify-center gap-4 sm:gap-8">
          {segments.map((seg) => (
            <div key={seg.label}>
              <div className="text-4xl sm:text-5xl font-bold text-parchment tabular-nums">
                {String(seg.value).padStart(2, '0')}
              </div>
              <div className="text-xs sm:text-sm text-parchment/60 mt-1 uppercase tracking-wider">
                {seg.label}
              </div>
            </div>
          ))}
        </div>
      )}

      {ctaText && ctaUrl && (
        <a
          href={ctaUrl}
          className="inline-block mt-8 px-6 py-3 rounded-lg text-sm font-medium bg-bark text-parchment hover:bg-copper-dark transition-colors"
        >
          {ctaText}
        </a>
      )}
    </div>
  );
}
