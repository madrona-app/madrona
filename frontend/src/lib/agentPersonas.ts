/**
 * Human-facing labels for the agent personas Studio coordinates. Shared so the
 * plan timeline and the Studio session header name agents the same way.
 */
export const SPECIALIST_LABELS: Record<string, string> = {
  registrar: 'Registrar',
  loans_registrar: 'Loans Registrar',
  conservator: 'Conservator',
  rights_specialist: 'Rights Specialist',
  curator: 'Curator',
};

/** Label for a persona key, falling back to the raw key when unmapped. */
export function personaLabel(persona: string): string {
  return SPECIALIST_LABELS[persona] ?? persona;
}
