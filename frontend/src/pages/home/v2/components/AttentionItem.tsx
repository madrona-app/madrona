import { Link } from 'react-router-dom';
import type { AttentionItem as AttentionItemModel, AttentionItemType, AttentionSeverity } from '../types';

const SEVERITY_BAR: Record<AttentionSeverity, string> = {
  urgent: 'bg-bark',
  this_week: 'bg-copper',
  informational: 'bg-moss',
};

const TYPE_BADGE: Record<AttentionItemType, { bg: string; text: string; label: string }> = {
  incident: { bg: 'bg-bark/15', text: 'text-bark', label: 'Incident' },
  loan: { bg: 'bg-copper/20', text: 'text-copper-dark', label: 'Loan' },
  accession: { bg: 'bg-moss/20', text: 'text-moss', label: 'Accession' },
  condition_report: { bg: 'bg-semantic-warning/15', text: 'text-semantic-warning', label: 'Condition' },
};

export function AttentionItemRow({ item }: { item: AttentionItemModel }) {
  const badge = TYPE_BADGE[item.type];
  const isLinkable = item.href && item.href !== '#';

  const inner = (
    <>
      <div className={`w-1 ${SEVERITY_BAR[item.severity]} rounded-sm flex-shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`${badge.bg} ${badge.text} text-[9px] font-medium px-1.5 py-0.5 rounded tracking-[0.08em] uppercase`}>
            {badge.label}
          </span>
          <span className="font-mono text-[11px] text-archive">{item.refNumber}</span>
        </div>
        <div className="text-sm font-medium text-ink mb-0.5 truncate">{item.title}</div>
        <div className="text-xs text-archive">{item.context}</div>
      </div>
    </>
  );

  const baseClasses =
    'flex gap-3 py-3 border-t border-forest/10 first:border-t-0 -mx-2 px-2 rounded';

  if (!isLinkable) {
    return <div className={baseClasses}>{inner}</div>;
  }

  return (
    <Link
      to={item.href}
      className={`${baseClasses} hover:bg-stone/30 transition-colors no-underline`}
    >
      {inner}
    </Link>
  );
}
