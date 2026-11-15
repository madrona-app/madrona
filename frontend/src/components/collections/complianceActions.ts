/** Structured compliance actions (compliance_actions rows) in a record payload. */

export interface ComplianceActionItem {
  action_id: string;
  title?: string | null;
  status?: string | null;
}

/** Entries of a payload array that are structured actions (strings and junk are skipped). */
export function toComplianceActions(raw: unknown): ComplianceActionItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (a): a is ComplianceActionItem =>
      !!a && typeof a === 'object' && typeof (a as { action_id?: unknown }).action_id === 'string',
  );
}
