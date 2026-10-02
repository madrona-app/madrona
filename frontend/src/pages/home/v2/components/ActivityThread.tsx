import { Link } from 'react-router-dom';
import { ActivityEntryRow } from './ActivityEntry';
import type { ActivityEntry } from '../types';

interface ActivityThreadProps {
  entries: ActivityEntry[];
  viewAllHref: string | null;
}

export function ActivityThread({ entries, viewAllHref }: ActivityThreadProps) {
  return (
    <div>
      <header className="flex items-baseline justify-between mb-3">
        <h2 className="font-serif text-base font-medium text-forest m-0">
          A short history of the last few hours
        </h2>
        {viewAllHref && entries.length > 0 && (
          <Link to={viewAllHref} className="text-[11px] text-bark hover:text-copper-dark no-underline">
            view all
          </Link>
        )}
      </header>
      {entries.length === 0 ? (
        <p className="text-sm text-archive m-0">No recent activity.</p>
      ) : (
        <div className="relative pl-[18px]">
          <div className="absolute left-1 top-1.5 bottom-1.5 w-px bg-forest/15" />
          {entries.slice(0, 8).map((entry) => (
            <ActivityEntryRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
