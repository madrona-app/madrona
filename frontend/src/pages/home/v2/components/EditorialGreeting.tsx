interface EditorialGreetingProps {
  name: string;
  /** v1: static helpful line. v2 (TODO): server-side Guide-generated summary. */
  subtitle: string;
}

function timeOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'evening';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export function EditorialGreeting({ name, subtitle }: EditorialGreetingProps) {
  return (
    <div className="mb-6 sm:mb-7">
      <h1 className="font-serif text-[28px] sm:text-[38px] font-normal leading-[1.15] tracking-tight text-forest m-0">
        Good {timeOfDay()}{name ? `, ${name}` : ''}.
      </h1>
      <p className="font-serif italic text-sm sm:text-[15px] text-archive mt-1.5 max-w-[540px] m-0">
        {subtitle}
      </p>
    </div>
  );
}
