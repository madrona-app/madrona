import { apiFetch } from '../apiClient';
import type { AgentPlanDetail } from './agentPlans';

export type ParamType = 'text' | 'enum' | 'date' | 'number' | 'boolean' | 'entity';

/** Typed metadata for one template param — drives the Start-procedure form. */
export interface TemplateParam {
  key: string;
  label: string;
  type: ParamType;
  required: boolean;
  enum_options: string[];
  from_context: boolean;
  /** For type='entity': which kind to search/pick ('object' | 'media'). */
  entity_kind: string | null;
  help_text: string | null;
}

/** Static step shape for the launch preview. */
export interface TemplateStep {
  kind: 'tool_call' | 'delegate' | 'await' | 'decision';
  persona: string | null;
  description: string;
}

/** A startable procedure (catalog plan template). */
export interface PlanTemplate {
  template_id: string;
  title: string;
  goal: string;
  procedure: string | null;
  nav_item: string | null;
  params: TemplateParam[];
  steps: TemplateStep[];
}

/** Which surface is asking — picks the runnable subset of the catalog.
 * - navItem: a workspace list page (e.g. 'acquisitions')
 * - requiresContext: an entity-detail page (e.g. 'object_id' on an object page)
 * - noContext: the central list (only procedures runnable without page context)
 */
export interface TemplateSurface {
  navItem?: string;
  requiresContext?: string;
  noContext?: boolean;
}

/** Startable procedures for a given surface. */
export function listPlanTemplates(
  orgId: string,
  surface?: TemplateSurface,
): Promise<{ templates: PlanTemplate[] }> {
  const p = new URLSearchParams();
  if (surface?.navItem) p.set('nav_item', surface.navItem);
  if (surface?.requiresContext) p.set('requires_context', surface.requiresContext);
  if (surface?.noContext) p.set('no_context', 'true');
  const q = p.toString();
  return apiFetch(`/organizations/${orgId}/agent/plan-templates${q ? `?${q}` : ''}`);
}

export interface CreatePlanFromTemplateBody {
  template_id: string;
  params: Record<string, unknown>;
  context_entity_type?: string;
  context_entity_id?: string;
}

/** Deterministically create a plan from a template (the forced entry point). */
export function createPlanFromTemplate(
  orgId: string,
  body: CreatePlanFromTemplateBody,
): Promise<AgentPlanDetail> {
  return apiFetch(`/organizations/${orgId}/agent/plans`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
