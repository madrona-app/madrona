/**
 * Visual indicator shown while a tool is executing.
 * Displays a brief label like "Searching collection..."
 *
 * Special-cased for `delegate_to_specialist`: shows "Asking the {specialist}…"
 * with the chosen specialist persona, since a generic label hides the
 * useful information from the user.
 */

const TOOL_LABELS: Record<string, string> = {
  search_collection: 'Searching collection',
  get_object_detail: 'Looking up object',
  list_current_exhibitions: 'Checking exhibitions',
  get_exhibition_info: 'Loading exhibition',
  lookup_vocabulary_term: 'Looking up vocabulary',
  get_object_history: 'Checking object history',
  suggest_cataloging: 'Analyzing cataloging',
};

const SPECIALIST_LABELS: Record<string, string> = {
  registrar: 'registrar',
  loans_registrar: 'loans registrar',
  conservator: 'conservator',
  rights_specialist: 'rights specialist',
  curator: 'curator',
};

interface AgentToolIndicatorProps {
  toolName: string;
  /** When toolName is 'delegate_to_specialist', the chosen specialist persona. */
  specialist?: string;
}

export function AgentToolIndicator({ toolName, specialist }: AgentToolIndicatorProps) {
  let label: string;
  if (toolName === 'delegate_to_specialist') {
    const who = specialist ? (SPECIALIST_LABELS[specialist] ?? specialist) : 'specialist';
    label = `Asking the ${who}`;
  } else {
    label = TOOL_LABELS[toolName] || 'Working';
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-archive italic">
      <span className="inline-block h-2 w-2 rounded-full bg-bark animate-pulse" />
      {label}...
    </div>
  );
}
