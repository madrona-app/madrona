import { AttentionItemRow } from './AttentionItem';
import type { AttentionItem } from '../types';

interface AttentionQueueProps {
  items: AttentionItem[];
}

export function AttentionQueue({ items }: AttentionQueueProps) {
  if (items.length === 0) {
    return (
      <section className="bg-parchment-warm border border-forest/10 rounded-xl px-5 py-3.5">
        <p className="text-sm text-archive m-0">Nothing needs attention right now.</p>
      </section>
    );
  }

  return (
    <section className="bg-parchment-warm border border-forest/10 rounded-xl px-5 py-4">
      <header className="flex items-baseline justify-between mb-3.5">
        <h2 className="font-serif text-lg font-medium text-forest m-0">For your attention</h2>
        <span className="text-[11px] text-archive tracking-wider">
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
      </header>
      <div>
        {items.map((item) => (
          <AttentionItemRow key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
