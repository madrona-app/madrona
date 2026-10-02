import { Search, SlidersHorizontal, X } from 'lucide-react';
import { formatNumber } from '@/lib/formatters';
import type { DiscoverCollectionInfo } from '../../../types/discover';

interface HeroSectionProps {
  info: DiscoverCollectionInfo | undefined;
  searchInput: string;
  onSearchChange: (value: string) => void;
  onClearSearch: () => void;
  onToggleFilters: () => void;
}

export function HeroSection({
  info,
  searchInput,
  onSearchChange,
  onClearSearch,
  onToggleFilters,
}: HeroSectionProps) {
  const title = info?.page_title || info?.organization_name || 'Collection';
  const subtitle = info?.page_subtitle;
  const showCount = info?.show_object_count ?? true;
  const heroUrl = info?.hero_image_url;

  return (
    <section className="relative min-h-[40vh] flex flex-col items-center justify-center overflow-hidden py-10">
      {/* Background image or solid bg — uses brand primary color if set */}
      {heroUrl ? (
        <>
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${heroUrl})` }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to top, var(--c-primary, #1F3A2E), color-mix(in srgb, var(--c-primary, #1F3A2E) 60%, transparent), color-mix(in srgb, var(--c-primary, #1F3A2E) 30%, transparent))`,
            }}
          />
        </>
      ) : (
        <>
          {/* No hero image: composed fallback so the hero reads as intentional
              rather than an empty color field — a gradient for depth plus an
              oversized, very-low-opacity serif monogram watermark. */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, color-mix(in srgb, var(--c-primary, #1F3A2E) 82%, #F7F4ED) 0%, var(--c-primary, #1F3A2E) 44%, color-mix(in srgb, var(--c-primary, #1F3A2E) 80%, #000) 100%)',
            }}
          />
          <div
            aria-hidden
            className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none select-none"
          >
            <span className="font-serif font-light leading-none text-parchment/[0.06] text-[36vh]">
              {title.charAt(0).toUpperCase()}
            </span>
          </div>
        </>
      )}

      {/* Content */}
      <div className="relative z-10 max-w-4xl mx-auto px-4 text-center">
        <h1 className="font-serif text-4xl md:text-5xl font-light text-parchment tracking-widest uppercase">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-4 text-lg text-parchment/70 max-w-2xl mx-auto">
            {subtitle}
          </p>
        )}
        {showCount && info && (
          <p className="mt-2 text-sm text-parchment/60 tracking-wide uppercase">
            {formatNumber(info.total_discoverable)} objects
          </p>
        )}

        {/* Search bar */}
        <div className="mt-6 max-w-2xl mx-auto flex items-center gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-parchment/50" />
            <input
              type="text"
              placeholder="Search the collection..."
              value={searchInput}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-12 pr-10 py-3.5 bg-parchment/10 backdrop-blur-sm border border-parchment/20 rounded-lg text-parchment placeholder:text-parchment/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-parchment/30 focus-visible:ring-offset-2 focus-visible:border-parchment/40 text-base"
            />
            {searchInput && (
              <button
                onClick={onClearSearch}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-parchment/50 hover:text-parchment"
              >
                <X size={18} />
              </button>
            )}
          </div>
          <button
            onClick={onToggleFilters}
            className="p-3.5 bg-parchment/10 backdrop-blur-sm border border-parchment/20 rounded-lg text-parchment/70 hover:text-parchment hover:bg-parchment/20 transition-colors"
            aria-label="Toggle filters"
          >
            <SlidersHorizontal size={20} />
          </button>
        </div>
      </div>
    </section>
  );
}
