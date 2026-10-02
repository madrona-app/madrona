import { Link } from 'react-router-dom';
import type { AppStatus } from '../types';
import { AppTile } from '../../../../components/AppTile';

interface WorkshopProps {
  apps: AppStatus[];
}

export function Workshop({ apps }: WorkshopProps) {
  // A single tile in the wider 1.4fr column reads as oddly sparse — show a
  // compact "your app" line instead. If no apps are enabled, hide the panel.
  if (apps.length === 0) return null;
  if (apps.length === 1) {
    const app = apps[0];
    return (
      <div>
        <h2 className="font-serif text-base font-medium text-forest m-0 mb-3">
          Your app
        </h2>
        <Link
          to={app.href}
          viewTransition
          className="bg-parchment-warm border border-forest/10 rounded-lg px-3 py-[0.4rem] flex items-center gap-[0.4rem] hover:border-bark/30 transition-colors no-underline w-fit"
        >
          <AppTile appKey={app.key} />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-ink truncate">
              {app.name}
            </div>
            <div className="text-[11px] text-archive truncate">
              {app.statusLine}
            </div>
          </div>
          {app.isActive && <span className="text-[10px] text-moss ml-2">●</span>}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h2 className="font-serif text-base font-medium text-forest m-0 mb-3">The workshop</h2>
      <div className="flex flex-col gap-[0.4rem]">
        {apps.map((app) => {
          return (
            <Link
              key={app.key}
              to={app.href}
              viewTransition
              className="bg-parchment-warm border border-forest/10 rounded-lg px-3 py-[0.4rem] flex items-center gap-[0.4rem] hover:border-bark/30 transition-colors no-underline"
            >
              <AppTile appKey={app.key} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-ink truncate">{app.name}</div>
                <div className="text-[11px] text-archive truncate">{app.statusLine}</div>
              </div>
              {app.isActive && <span className="text-[10px] text-moss">●</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
