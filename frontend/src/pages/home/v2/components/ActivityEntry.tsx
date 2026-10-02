import { Link } from 'react-router-dom';
import type { ActivityEntry as ActivityEntryModel, ActivityEntryKind } from '../types';
import { formatRelativeTime } from '../../../../lib/formatters';

const DOT_COLOR: Record<ActivityEntryKind, string> = {
  self: 'bg-copper',
  incident: 'bg-bark',
  system: 'bg-forest/30',
};

export function ActivityEntryRow({ entry }: { entry: ActivityEntryModel }) {
  const inner = (
    <div className="flex justify-between items-baseline gap-3">
      <div
        className="text-[13px] text-ink"
        // entry.text is rendered as plain text (no HTML); future v2 can switch to a
        // structured shape (verb + object refs) instead of pre-rendered strings.
      >
        {entry.text}
      </div>
      <div className="text-[11px] text-archive whitespace-nowrap">
        {formatRelativeTime(new Date(entry.timestamp))}
      </div>
    </div>
  );

  return (
    <div className="relative pt-1 pb-3.5">
      <div
        className={`absolute -left-[18px] top-1.5 w-2.5 h-2.5 rounded-full ${DOT_COLOR[entry.kind]} border-2 border-parchment`}
      />
      {entry.href ? (
        <Link to={entry.href} className="no-underline">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </div>
  );
}
