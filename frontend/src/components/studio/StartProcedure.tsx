import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Play, X, Cog, Network, Hourglass, Split, ArrowRight, type LucideIcon } from 'lucide-react';
import { MadronaLoader } from '../ui/MadronaLoader';
import { ErrorState } from '../ui/ErrorState';
import { StudioAvatar } from './StudioAvatar';
import { StudioEntityPicker } from './StudioEntityPicker';
import { useAuth } from '../../hooks/useAuth';
import { useActiveProduct, workBasePath } from '../../hooks/useActiveProduct';
import {
  listPlanTemplates,
  createPlanFromTemplate,
  type PlanTemplate,
  type TemplateParam,
} from '../../lib/api/planTemplates';
import { runAgentPlan } from '../../lib/api/agentPlans';

/**
 * StartProcedure — the deterministic ("forced") entry point for a Studio plan.
 *
 * Three acts (the agreed UX): a DOMINANT launch takeover that previews the whole
 * plan (steps · agents · sign-offs — the "power" moment), a brief working state,
 * then it dissolves IN PLACE into a gently-pulsing "Review" pill pointing at the
 * drafts (no forced navigation). The plan also recedes to the Intelligence inbox
 * + nav badge (the background return-path).
 */
interface StartProcedureProps {
  navItem?: string;
  // Entity-detail surface: only templates taking this page-context id (e.g.
  // 'object_id'). Pair with contextEntityId so they run with the id in hand.
  requiresContext?: string;
  // Central surface: only templates that need no page context at all.
  noContext?: boolean;
  contextEntityType?: string;
  contextEntityId?: string;
  label?: string;
  className?: string;
}

const KIND_ICON: Record<string, LucideIcon> = {
  tool_call: Cog,
  delegate: Network,
  await: Hourglass,
  decision: Split,
};

function personaLabel(p: string | null): string | null {
  if (!p) return null;
  return p.split('_').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ');
}

function formParams(t: PlanTemplate, hasContext: boolean): TemplateParam[] {
  // from_context params are hidden ONLY when the surface supplies the id (an
  // entity detail page); otherwise the user picks the entity inline, so a
  // context-scoped procedure stays runnable from the central list too.
  return t.params.filter((p) => !(p.from_context && hasContext));
}

export function StartProcedure({
  navItem,
  requiresContext,
  noContext,
  contextEntityType,
  contextEntityId,
  label = 'Start a procedure',
  className,
}: StartProcedureProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const { activeProductId } = useActiveProduct();
  const { hasAppAccess } = useAuth();
  // Guide Studio's entry point, embedded in ordinary Collections and Media
  // pages. With Guide off the template endpoint is agent-gated, so the
  // control renders and then fails with "Couldn't load procedures" for a
  // feature the organization has switched off. Gated here rather than at
  // the five call sites, so a sixth cannot reintroduce it.
  const guideEnabled = hasAppAccess('guide');

  type Phase = 'idle' | 'launch' | 'done';
  const [phase, setPhase] = useState<Phase>('idle');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [donePlanId, setDonePlanId] = useState<string | null>(null);
  const [pulsing, setPulsing] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['plan-templates', orgId, navItem ?? '', requiresContext ?? '', noContext ?? false],
    queryFn: () => listPlanTemplates(orgId as string, { navItem, requiresContext, noContext }),
    enabled: !!orgId && phase === 'launch' && guideEnabled,
  });

  const templates = data?.templates ?? [];
  const selected = useMemo(
    () => templates.find((t) => t.template_id === selectedId) ?? (templates.length === 1 ? templates[0] : null),
    [templates, selectedId],
  );

  // The launch CTA both creates the plan AND runs it, so the takeover shows real
  // work before dissolving to the pill.
  const run = useMutation({
    mutationFn: async (t: PlanTemplate) => {
      const plan = await createPlanFromTemplate(orgId as string, {
        template_id: t.template_id,
        params: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '' && v != null)),
        context_entity_type: contextEntityType,
        context_entity_id: contextEntityId,
      });
      await runAgentPlan(orgId as string, plan.plan_id);
      return plan.plan_id;
    },
    onSuccess: (planId) => {
      setDonePlanId(planId);
      setPhase('done');
      setPulsing(true);
    },
  });

  // Settling pulse: a few beats, then steady (honors §8 — no perpetual motion).
  useEffect(() => {
    if (!pulsing) return;
    const t = window.setTimeout(() => setPulsing(false), 4500);
    return () => window.clearTimeout(t);
  }, [pulsing]);

  function reset() {
    setPhase('idle');
    setSelectedId(null);
    setValues({});
    run.reset();
  }

  const hasContext = !!contextEntityId;
  const required = selected ? formParams(selected, hasContext).filter((p) => p.required) : [];
  const canRun = !!selected && !run.isPending && required.every((p) =>
    p.type === 'boolean' ? true : values[p.key] !== undefined && values[p.key] !== '');

  // ── Done: the in-place pulsing pill (replaces the trigger) ──────────────────
  // After the hooks, before any branch that renders.
  if (!guideEnabled) return null;

  if (phase === 'done' && donePlanId) {
    return (
      <span className={`relative inline-flex ${className ?? ''}`}>
        {pulsing && (
          <span className="absolute inset-0 rounded-full bg-copper/40 animate-ping" aria-hidden />
        )}
        <Link
          to={`${workBasePath(orgId as string, activeProductId)}/plans/${donePlanId}`}
          className="relative inline-flex items-center gap-2 rounded-full bg-forest text-parchment px-3 py-1.5 text-xs font-medium hover:bg-forest/90 transition-colors focus-visible:ring-2 ring-copper/40 ring-offset-2"
        >
          <StudioAvatar size={18} />
          Studio drafted your records
          <span className="text-copper inline-flex items-center gap-0.5">Review <ArrowRight size={13} aria-hidden /></span>
        </Link>
        <button onClick={reset} className="ml-1 text-archive hover:text-ink" aria-label="Dismiss" title="Dismiss">
          <X size={14} />
        </button>
      </span>
    );
  }

  return (
    <>
      <button type="button" className={`btn-primary inline-flex items-center gap-2 ${className ?? ''}`} onClick={() => setPhase('launch')}>
        <Play size={15} aria-hidden /> {label}
      </button>

      {phase === 'launch' && (
        <div
          className="sidebar-aware-modal fixed top-0 right-0 bottom-0 z-[1000] flex items-center justify-center bg-ink/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Start a Studio procedure"
          onClick={() => !run.isPending && reset()}
          onKeyDown={(e) => { if (e.key === 'Escape' && !run.isPending) reset(); }}
        >
          <div
            className="w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden rounded-xl bg-parchment shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Forest header — the dominant Studio moment (fixed; body scrolls) */}
            <div className="flex items-center gap-3 bg-forest px-5 py-4 shrink-0">
              <StudioAvatar size={28} />
              <div className="min-w-0">
                <div className="font-display font-medium text-lg text-parchment leading-none">
                  Studio{selected ? ` · ${selected.title}` : ''}
                </div>
                <div className="text-[11px] text-parchment/70 mt-1">
                  Runs the procedure and deposits drafts for your review
                </div>
              </div>
              {!run.isPending && (
                <button onClick={reset} className="ml-auto text-parchment/70 hover:text-parchment" aria-label="Close">
                  <X size={18} />
                </button>
              )}
            </div>

            <div className="p-5 overflow-y-auto">
              {isLoading && <div className="flex justify-center py-10"><MadronaLoader variant="inline" label="Loading procedures…" /></div>}
              {!isLoading && isError && <ErrorState variant="compact" title="Couldn't load procedures." onRetry={() => refetch()} />}
              {!isLoading && !isError && templates.length === 0 && (
                <p className="text-sm text-archive py-6">No procedures available here yet.</p>
              )}

              {/* Picker (multiple, none chosen) */}
              {!isLoading && templates.length > 1 && !selectedId && (
                <ul className="flex flex-col gap-2">
                  {templates.map((t) => (
                    <li key={t.template_id}>
                      <button type="button" onClick={() => setSelectedId(t.template_id)}
                        className="w-full text-left rounded-md border border-lichen hover:border-bark/40 hover:bg-stone/30 px-3 py-2.5 transition-colors focus-visible:ring-2 ring-bark/30 ring-offset-2">
                        <div className="text-sm font-medium text-ink">{t.title}</div>
                        {t.procedure && <div className="text-xs text-archive mt-0.5">{t.procedure}</div>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Preview + form for the chosen template */}
              {selected && <LaunchBody
                template={selected}
                orgId={orgId as string}
                hasContext={hasContext}
                values={values}
                setValues={setValues}
                working={run.isPending}
                error={run.isError}
                canRun={canRun}
                onRun={() => run.mutate(selected)}
                onBack={templates.length > 1 ? () => setSelectedId(null) : undefined}
              />}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function LaunchBody({ template, orgId, hasContext, values, setValues, working, error, canRun, onRun, onBack }: {
  template: PlanTemplate;
  orgId: string;
  hasContext: boolean;
  values: Record<string, string | boolean>;
  setValues: (fn: (s: Record<string, string | boolean>) => Record<string, string | boolean>) => void;
  working: boolean;
  error: boolean;
  canRun: boolean;
  onRun: () => void;
  onBack?: () => void;
}) {
  const agents = Array.from(new Set(template.steps.map((s) => personaLabel(s.persona)).filter(Boolean) as string[]));
  const gates = template.steps.filter((s) => s.kind === 'await').length;

  return (
    <div className="flex flex-col gap-5">
      {/* The power preview: what Studio will do, before it runs */}
      <div>
        <p className="text-sm text-ink">{template.goal}</p>
        <p className="text-xs text-archive mt-1 font-mono">
          {template.steps.length} steps
          {agents.length > 0 && ` · ${agents.length} agent${agents.length !== 1 ? 's' : ''}`}
          {gates > 0 && ` · ${gates} sign-off${gates !== 1 ? 's' : ''}`}
        </p>
        <ol className="mt-3 flex flex-col gap-1.5">
          {template.steps.map((s, i) => {
            const Icon = KIND_ICON[s.kind] ?? Cog;
            const who = personaLabel(s.persona);
            return (
              <li key={i} className={`flex items-start gap-2 text-sm ${working ? 'opacity-100' : ''}`}>
                <Icon size={14} className={`mt-0.5 shrink-0 ${s.kind === 'await' ? 'text-semantic-warning' : 'text-bark'}`} aria-hidden />
                <span className="text-ink">{s.description}</span>
                {who && <span className="text-[11px] text-archive shrink-0">· {who}</span>}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Typed param form */}
      {formParams(template, hasContext).length > 0 && (
        <div className="flex flex-col gap-3 border-t border-lichen pt-4">
          {formParams(template, hasContext).map((p) => {
            const id = `sp-${p.key}`;
            const v = values[p.key];
            return (
              <div key={p.key}>
                <label htmlFor={id} className="block text-sm font-medium text-ink mb-1">
                  {p.label}{p.required && <span className="text-bark"> *</span>}
                </label>
                {p.type === 'entity' ? (
                  <StudioEntityPicker
                    id={id}
                    orgId={orgId}
                    entityKind={p.entity_kind ?? 'object'}
                    value={typeof v === 'string' ? v : undefined}
                    disabled={working}
                    onChange={(entityId) =>
                      setValues((s) => ({ ...s, [p.key]: entityId ?? '' }))}
                  />
                ) : p.type === 'enum' ? (
                  <select id={id} value={(v as string) ?? ''} disabled={working}
                    onChange={(e) => setValues((s) => ({ ...s, [p.key]: e.target.value }))}
                    className="w-full rounded-md border border-lichen bg-parchment-warm px-3 py-2 text-sm text-ink focus-visible:ring-2 ring-bark/30 ring-offset-2 outline-none">
                    <option value="">Select…</option>
                    {p.enum_options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                ) : p.type === 'boolean' ? (
                  <input id={id} type="checkbox" checked={!!v} disabled={working} className="accent-bark"
                    onChange={(e) => setValues((s) => ({ ...s, [p.key]: e.target.checked }))} />
                ) : (
                  <input id={id} type={p.type === 'date' ? 'date' : p.type === 'number' ? 'number' : 'text'}
                    value={(v as string) ?? ''} disabled={working}
                    onChange={(e) => setValues((s) => ({ ...s, [p.key]: e.target.value }))}
                    className="w-full rounded-md border border-lichen bg-parchment-warm px-3 py-2 text-sm text-ink focus-visible:ring-2 ring-bark/30 ring-offset-2 outline-none" />
                )}
                {p.help_text && <p className="text-xs text-archive mt-1">{p.help_text}</p>}
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="text-sm text-semantic-error">Couldn&rsquo;t run this procedure. Check the fields and try again.</p>}

      <div className="flex items-center gap-3 pt-1">
        <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={!canRun} onClick={onRun}>
          {working ? <><MadronaLoader variant="dots" dotSize={5} /> Studio is working…</> : <><Play size={15} aria-hidden /> Run it</>}
        </button>
        {onBack && !working && <button type="button" className="btn-tertiary" onClick={onBack}>Back</button>}
      </div>
    </div>
  );
}

export default StartProcedure;
