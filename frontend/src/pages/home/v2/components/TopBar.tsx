function formatDate(now: Date): string {
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const day = now.getDate();
  const month = now.toLocaleDateString('en-US', { month: 'long' });
  return `${weekday} · ${day} ${month}`;
}

export function TopBar() {
  return (
    <div className="flex items-center justify-between mb-5">
      <div className="text-[11px] tracking-[0.18em] text-archive uppercase">
        {formatDate(new Date())}
      </div>
      <div className="text-xs text-archive">⌘K to search</div>
    </div>
  );
}
