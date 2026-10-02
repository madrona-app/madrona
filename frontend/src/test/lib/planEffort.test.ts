import { describe, it, expect } from 'vitest';
import {
  COPPER,
  effortColor,
  effortStatLine,
  effortBucket,
  effortLead,
  effortRaw,
  relativeTime,
  formatCost,
  formatDuration,
  formatTokens,
  hasAiCost,
} from '../../lib/planEffort';
import type { StepEffort } from '../../lib/api/agentPlans';

function effort(p: Partial<StepEffort> = {}): StepEffort {
  return {
    input_tokens: null,
    output_tokens: null,
    llm_rounds: null,
    tool_calls: null,
    latency_ms: null,
    delegation_depth: null,
    cost_estimate_usd: null,
    raw_effort: null,
    weight: 0,
    model_id: null,
    attempt: 1,
    ...p,
  };
}

describe('planEffort', () => {
  it('hasAiCost is false for deterministic steps, true with LLM work', () => {
    expect(hasAiCost(effort({ tool_calls: 1 }))).toBe(false);
    expect(hasAiCost(effort({ llm_rounds: 2 }))).toBe(true);
    expect(hasAiCost(effort({ input_tokens: 100 }))).toBe(true);
    expect(hasAiCost(null)).toBe(false);
  });

  it('effortColor ramps from stone (no cost) to copper (heaviest)', () => {
    expect(effortColor(0)).toBe('rgb(var(--color-stone))'); // stone
    expect(effortColor(1)).toBe(COPPER);
    expect(effortColor(0.2)).not.toBe(effortColor(0.9)); // distinct buckets
  });

  it('formats tokens, cost, duration', () => {
    expect(formatTokens(950)).toBe('950 tok');
    expect(formatTokens(1800)).toBe('1.8k tok');
    expect(formatTokens(null)).toBeNull();
    expect(formatCost(0.04)).toBe('$0.04');
    expect(formatCost(0.005)).toBe('<$0.01');
    expect(formatCost(null)).toBeNull();
    expect(formatDuration(4200)).toBe('4.2s');
    expect(formatDuration(800)).toBe('800ms');
    expect(formatDuration(null)).toBeNull();
  });

  it('effortStatLine joins the real numbers', () => {
    const line = effortStatLine(
      effort({ input_tokens: 1500, output_tokens: 300, llm_rounds: 2, tool_calls: 3, latency_ms: 4200 }),
    );
    expect(line).toContain('1.8k tok');
    expect(line).toContain('2 rounds');
    expect(line).toContain('3 calls');
    expect(line).toContain('4.2s');
  });
});

describe('planEffort §4 demotion helpers', () => {
  it('effortBucket tiers by normalized weight', () => {
    expect(effortBucket(0.1)).toBe('light');
    expect(effortBucket(0.5)).toBe('moderate');
    expect(effortBucket(0.9)).toBe('heavy');
  });

  it('effortLead leads with bucket + time', () => {
    expect(effortLead(effort({ weight: 0.1, latency_ms: 4200 }))).toBe('light effort · 4.2s');
    expect(effortLead(effort({ weight: 0.9, latency_ms: null }))).toBe('heavy effort');
  });

  it('effortRaw shows tokens + cost, omits null cost (never a fake $0)', () => {
    const r = effortRaw(effort({ input_tokens: 600, output_tokens: 500, cost_estimate_usd: 0.004 }));
    expect(r).toContain('1.1k tok');
    expect(r).toContain('<$0.01');
    // unpriced → tokens only, no $ at all
    expect(effortRaw(effort({ input_tokens: 100, output_tokens: 0, cost_estimate_usd: null }))).toBe('100 tok');
  });

  it('relativeTime renders client-side from an absolute ISO', () => {
    expect(relativeTime(null)).toBeNull();
    expect(relativeTime('not-a-date')).toBeNull();
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    expect(relativeTime(twoHoursAgo)).toBe('2h ago');
  });
});
