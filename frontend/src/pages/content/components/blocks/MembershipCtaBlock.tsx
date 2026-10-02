/**
 * Membership CTA Block — Membership tiers with pricing and benefits.
 */

import { useCallback } from 'react';
import { Plus, Trash2, ChevronDown, GripVertical, Check } from 'lucide-react';
import { cn } from '../../../../lib/utils';

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

interface MembershipTier {
  name: string;
  price: string;
  benefits: string[];
}

// =============================================================================
// Editor
// =============================================================================

export function MembershipCtaEditor({ content, onChange }: BlockEditorComponentProps) {
  const heading = (content.heading as string) || '';
  const description = (content.description as string) || '';
  const tiers = (content.tiers as MembershipTier[]) || [];
  const ctaUrl = (content.cta_url as string) || '';

  const updateTier = useCallback(
    (index: number, field: keyof MembershipTier, value: string | string[]) => {
      const updated = tiers.map((tier, i) =>
        i === index ? { ...tier, [field]: value } : tier,
      );
      onChange({ ...content, tiers: updated });
    },
    [tiers, content, onChange],
  );

  const addTier = useCallback(() => {
    onChange({
      ...content,
      tiers: [...tiers, { name: '', price: '', benefits: [] }],
    });
  }, [tiers, content, onChange]);

  const removeTier = useCallback(
    (index: number) => {
      onChange({ ...content, tiers: tiers.filter((_, i) => i !== index) });
    },
    [tiers, content, onChange],
  );

  const moveTier = useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= tiers.length) return;
      const updated = [...tiers];
      [updated[index], updated[target]] = [updated[target], updated[index]];
      onChange({ ...content, tiers: updated });
    },
    [tiers, content, onChange],
  );

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Heading
        </label>
        <input
          type="text"
          value={heading}
          onChange={(e) => onChange({ ...content, heading: e.target.value })}
          placeholder="e.g., Become a Member"
          className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => onChange({ ...content, description: e.target.value })}
          placeholder="Support the museum and enjoy exclusive benefits."
          rows={3}
          className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full resize-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Membership URL
        </label>
        <input
          type="text"
          value={ctaUrl}
          onChange={(e) => onChange({ ...content, cta_url: e.target.value })}
          placeholder="e.g., /membership or https://..."
          className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
        />
      </div>

      {/* Tiers */}
      <div>
        <label className="block text-sm font-medium text-ink mb-2">
          Tiers
        </label>

        {tiers.length === 0 && (
          <p className="text-sm text-archive italic">
            No tiers yet. Add one below.
          </p>
        )}

        <div className="space-y-3">
          {tiers.map((tier, index) => (
            <div
              key={index}
              className="border border-lichen rounded-lg p-3 space-y-2 bg-stone"
            >
              <div className="flex items-center gap-2">
                <GripVertical size={14} className="shrink-0 text-archive" />
                <span className="text-xs text-archive font-medium">
                  Tier #{index + 1}
                </span>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => moveTier(index, -1)}
                  disabled={index === 0}
                  className="p-1 text-archive hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Move up"
                >
                  <ChevronDown size={14} className="rotate-180" />
                </button>
                <button
                  type="button"
                  onClick={() => moveTier(index, 1)}
                  disabled={index === tiers.length - 1}
                  className="p-1 text-archive hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Move down"
                >
                  <ChevronDown size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => removeTier(index)}
                  className="p-1 text-archive hover:text-semantic-error"
                  title="Remove tier"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={tier.name}
                  onChange={(e) => updateTier(index, 'name', e.target.value)}
                  placeholder="Tier name (e.g., Individual)"
                  className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
                />
                <input
                  type="text"
                  value={tier.price}
                  onChange={(e) => updateTier(index, 'price', e.target.value)}
                  placeholder="Price (e.g., $75/year)"
                  className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
                />
              </div>

              <div>
                <label className="block text-xs text-archive mb-1">
                  Benefits (one per line)
                </label>
                <textarea
                  value={(tier.benefits || []).join('\n')}
                  onChange={(e) => {
                    const benefits = e.target.value
                      .split('\n')
                      .filter((line) => line.length > 0);
                    updateTier(index, 'benefits', benefits);
                  }}
                  placeholder="Free admission&#10;Member events&#10;Gift shop discount"
                  rows={3}
                  className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full resize-none font-mono"
                />
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addTier}
          className="flex items-center gap-2 px-3 py-2 text-sm text-archive border border-dashed border-lichen rounded-lg hover:border-bark hover:text-bark transition-colors w-full mt-2"
        >
          <Plus size={14} />
          Add Tier
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Renderer
// =============================================================================

export function MembershipCtaRenderer({ content }: BlockRendererComponentProps) {
  const heading = (content.heading as string) || '';
  const description = (content.description as string) || '';
  const tiers = (content.tiers as MembershipTier[]) || [];
  const ctaUrl = (content.cta_url as string) || '';

  if (!heading) return null;

  const gridCols =
    tiers.length === 1
      ? 'grid-cols-1 max-w-sm mx-auto'
      : tiers.length === 2
        ? 'grid-cols-1 sm:grid-cols-2'
        : tiers.length >= 3
          ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
          : '';

  return (
    <div className="rounded-lg bg-stone border border-lichen px-6 py-10">
      <div className="text-center mb-8">
        <h3 className="text-2xl font-bold text-ink mb-2">{heading}</h3>
        {description && (
          <p className="text-sm text-archive max-w-lg mx-auto">{description}</p>
        )}
      </div>

      {tiers.length > 0 && (
        <div className={cn('grid gap-6 mb-8', gridCols)}>
          {tiers.map((tier, index) => (
            <div
              key={index}
              className={cn(
                'rounded-lg border p-6 text-center transition-colors',
                index === Math.floor(tiers.length / 2) && tiers.length > 1
                  ? 'border-bark bg-parchment shadow-sm'
                  : 'border-lichen bg-parchment',
              )}
            >
              <h4 className="text-lg font-semibold text-ink mb-1">{tier.name}</h4>
              <p className="text-2xl font-bold text-bark mb-4">{tier.price}</p>
              {tier.benefits && tier.benefits.length > 0 && (
                <ul className="space-y-2 text-left">
                  {tier.benefits.map((benefit, bi) => (
                    <li key={bi} className="flex items-start gap-2 text-sm text-ink">
                      <Check size={14} className="shrink-0 mt-0.5 text-semantic-success" />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {ctaUrl && (
        <div className="text-center">
          <a
            href={ctaUrl}
            className="inline-block px-8 py-3 rounded-lg text-sm font-medium bg-bark text-parchment hover:bg-copper-dark transition-colors"
          >
            Become a Member
          </a>
        </div>
      )}
    </div>
  );
}
