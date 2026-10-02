import { cn } from '../../lib/utils';

/**
 * Studio audit-trail attribution (brand spec §6/§9). Studio is named as the
 * actor that produced the work: "Drafted by Studio · reviewed by … · approved …".
 *
 * Per §6, "Studio" is NOT specially styled here — this is operational metadata,
 * not branding — so the whole line is muted (archive), Source Sans. Per §9 the
 * verb is active production ("Drafted by"), not "AI-generated"/"powered by".
 */
interface StudioAttributionProps {
  /** Production verb. Default "Drafted". */
  verb?: string;
  /** Reviewer name, if reviewed. */
  reviewedBy?: string | null;
  /** Human-readable approval/decision timestamp, if decided. */
  decidedAt?: string | null;
  className?: string;
}

export function StudioAttribution({
  verb = 'Drafted',
  reviewedBy,
  decidedAt,
  className,
}: StudioAttributionProps) {
  const parts = [`${verb} by Studio`];
  if (reviewedBy) parts.push(`reviewed by ${reviewedBy}`);
  if (decidedAt) parts.push(`approved ${decidedAt}`);
  return (
    <span className={cn('font-sans text-xs text-archive', className)}>
      {parts.join(' · ')}
    </span>
  );
}

export default StudioAttribution;
