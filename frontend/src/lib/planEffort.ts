/**
 * §2D display helpers for orchestration effort telemetry.
 *
 * The server computes raw_effort + the plan-normalized `weight` (so the client
 * never derives from partial data). These helpers only FORMAT and COLOR it —
 * the heat ramp uses the Madrona palette (stone → moss → bark → copper), and a
 * step with no LLM cost is treated as "no AI cost", never a fake bar.
 */
import type { StepEffort } from './api/agentPlans';

// Madrona palette (hex from /CONVENTIONS.md). The heat bar reads cool→hot along this.
const STONE = 'rgb(var(--color-stone))';
const MOSS = '#5A7A52';
const BARK = '#B5481F';
export const COPPER = 'rgb(var(--color-copper))';

/** A step did real LLM work (so an effort bar is meaningful). Deterministic
 * tool_calls and pure awaits have no rounds/tokens → "no AI cost". */
export function hasAiCost(effort: StepEffort | null | undefined): boolean {
  if (!effort) return false;
  return (effort.llm_rounds ?? 0) > 0
    || (effort.input_tokens ?? 0) > 0
    || (effort.output_tokens ?? 0) > 0;
}

/** Heat color for a normalized weight (0–1) along stone→moss→bark→copper.
 * The heaviest step in a plan (weight≈1) reads copper. */
export function effortColor(weight: number): string {
  if (weight <= 0) return STONE;
  if (weight <= 0.34) return MOSS;
  if (weight <= 0.67) return BARK;
  return COPPER;
}

export function formatTokens(n: number | null | undefined): string | null {
  if (n === null || n === undefined) return null;
  if (n < 1000) return `${n} tok`;
  return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k tok`;
}

export function formatCost(usd: number | null | undefined): string | null {
  if (usd === null || usd === undefined) return null;
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export function formatDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined) return null;
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

/** Plain-language effort tier from the plan-normalized weight — the lead line a
 * non-technical user reads; the raw tokens/cost are demoted underneath. */
export function effortBucket(weight: number): 'light' | 'moderate' | 'heavy' {
  if (weight <= 0.34) return 'light';
  if (weight <= 0.67) return 'moderate';
  return 'heavy';
}

/** "light effort · 0.9s" — the demoted, human-first lead. */
export function effortLead(effort: StepEffort): string {
  const bucket = effortBucket(effort.weight ?? 0);
  const dur = formatDuration(effort.latency_ms);
  return dur ? `${bucket} effort · ${dur}` : `${bucket} effort`;
}

/** "1.1k tok · $0.004" — the raw figures, shown muted. Cost is omitted when
 * unpriced (null) so we never render a fake $0. */
export function effortRaw(effort: StepEffort): string | null {
  const parts: string[] = [];
  const tok = formatTokens(((effort.input_tokens ?? 0) + (effort.output_tokens ?? 0)) || null);
  if (tok) parts.push(tok);
  const cost = formatCost(effort.cost_estimate_usd);
  if (cost) parts.push(cost);
  return parts.length ? parts.join(' · ') : null;
}

/** Relative-time from an absolute ISO timestamp (rendered client-side so it
 * stays fresh across polls — the server never preformats "2h ago"). */
export function relativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** The compact "1.8k tok · 2 rounds · 4.2s" line beside the heat bar. */
export function effortStatLine(effort: StepEffort): string {
  const parts: string[] = [];
  const tokens = (effort.input_tokens ?? 0) + (effort.output_tokens ?? 0);
  const tok = formatTokens(tokens || null);
  if (tok) parts.push(tok);
  if (effort.llm_rounds) {
    parts.push(`${effort.llm_rounds} ${effort.llm_rounds === 1 ? 'round' : 'rounds'}`);
  }
  if (effort.tool_calls) {
    parts.push(`${effort.tool_calls} ${effort.tool_calls === 1 ? 'call' : 'calls'}`);
  }
  const dur = formatDuration(effort.latency_ms);
  if (dur) parts.push(dur);
  return parts.join(' · ');
}
