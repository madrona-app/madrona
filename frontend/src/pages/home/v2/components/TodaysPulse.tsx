import { Link } from 'react-router-dom';
import type { PulseData } from '../types';

interface TodaysPulseProps {
  pulseData: PulseData;
}

export function TodaysPulse({ pulseData }: TodaysPulseProps) {
  const { stats, recentObject } = pulseData;

  return (
    <section className="bg-forest text-parchment rounded-xl px-5 py-4 flex flex-col">
      <h2 className="font-serif text-lg font-medium m-0 mb-3.5">Today's pulse</h2>

      <div className="flex flex-col gap-3 flex-1">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="border border-parchment/30 rounded-md px-3 py-2"
          >
            <div className="font-serif text-[28px] leading-none text-parchment font-normal">
              {stat.value}
            </div>
            <div className="text-[10px] tracking-[0.15em] text-parchment/70 uppercase mt-1">
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {recentObject && (
        <div className="border-t border-parchment/15 pt-3 mt-3">
          <div className="text-[10px] tracking-[0.15em] text-parchment/55 uppercase mb-1.5">
            Most recently updated
          </div>
          <Link
            to={recentObject.href}
            className="font-serif italic text-sm text-parchment hover:underline hover:decoration-copper hover:underline-offset-2 no-underline focus-visible:outline-parchment"
          >
            <em>{recentObject.name}</em>{' '}
            <span className="text-parchment/60 not-italic">
              · updated {recentObject.updatedAgo}
            </span>
          </Link>
        </div>
      )}
    </section>
  );
}
