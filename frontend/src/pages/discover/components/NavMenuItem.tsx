/**
 * NavMenuItem — Single navigation item in the public site header.
 *
 * Renders a link with optional dropdown for children.
 * Supports mega menu panels when children have descriptions/images.
 * Resolves URLs by link_type.
 */

import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import type { PublicMenuItem } from '../../../types/content';

interface NavMenuItemProps {
  item: PublicMenuItem;
  orgSlug: string;
}

export function resolveUrl(item: PublicMenuItem, orgSlug: string): string {
  switch (item.link_type) {
    case 'page':
      return item.page_slug ? `/c/${orgSlug}/pages/${item.page_slug}` : '#';
    case 'collection':
      return `/c/${orgSlug}`;
    case 'category':
      return item.url ? `/c/${orgSlug}/blog?category=${item.url}` : '#';
    case 'exhibition':
      return item.url ? `/c/${orgSlug}/exhibitions/${item.url}` : `/c/${orgSlug}/exhibitions`;
    case 'event':
      return item.url ? `/c/${orgSlug}/events/${item.url}` : `/c/${orgSlug}/events`;
    case 'url':
    default:
      return item.url || '#';
  }
}

function isExternal(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

function NavLink({ url, className, onClick, children }: {
  url: string;
  className: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  if (isExternal(url)) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        onClick={onClick}
      >
        {children}
      </a>
    );
  }
  return (
    <Link to={url} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}

export function NavMenuItem({ item, orgSlug }: NavMenuItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasChildren = item.children && item.children.length > 0;

  const url = resolveUrl(item, orgSlug);

  // Detect if children have descriptions or images (mega menu)
  const hasMegaContent = hasChildren && item.children!.some(
    c => c.description || c.image_media_id
  );

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [isOpen]);

  const handleMouseEnter = () => {
    clearTimeout(timeoutRef.current);
    if (hasChildren) setIsOpen(true);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => setIsOpen(false), 200);
  };

  const linkClasses = "text-sm text-parchment/70 hover:text-parchment transition-colors";

  if (!hasChildren) {
    return (
      <NavLink url={url} className={linkClasses}>
        {item.label}
      </NavLink>
    );
  }

  // Has children — render with dropdown or mega menu
  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        onClick={() => setIsOpen((v) => !v)}
        className={`${linkClasses} inline-flex items-center gap-1`}
      >
        {item.label}
        <ChevronDown size={12} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        hasMegaContent ? (
          // Mega menu panel — grid with descriptions/images
          <div className="absolute left-0 top-full mt-1 min-w-[480px] max-w-[640px] bg-forest/95 backdrop-blur-sm border border-parchment/10 rounded-lg shadow-lg p-4 z-50">
            <div className="grid grid-cols-2 gap-3">
              {item.children!.map((child, i) => {
                const childUrl = resolveUrl(child, orgSlug);
                return (
                  <NavLink
                    key={i}
                    url={childUrl}
                    className={`block p-3 rounded-lg hover:bg-parchment/5 transition-colors ${child.highlight ? 'ring-1 ring-parchment/20' : ''}`}
                    onClick={() => setIsOpen(false)}
                  >
                    {child.image_media_id && (
                      <img
                        src={`/api/media/${child.image_media_id}/thumbnail?size=300`}
                        alt=""
                        className="w-full h-20 object-cover rounded mb-2"
                      />
                    )}
                    <span className="block text-sm font-medium text-parchment">
                      {child.label}
                    </span>
                    {child.description && (
                      <span className="block text-xs text-parchment/50 mt-1 line-clamp-2">
                        {child.description}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ) : (
          // Simple dropdown
          <div className="absolute left-0 top-full mt-1 min-w-[180px] bg-forest/95 backdrop-blur-sm border border-parchment/10 rounded-lg shadow-lg py-1 z-50">
            {/* Parent link */}
            <div className="border-b border-parchment/10 pb-1 mb-1">
              <NavLink
                url={url}
                className="block px-4 py-2 text-sm text-parchment/70 hover:text-parchment hover:bg-parchment/5 transition-colors"
                onClick={() => setIsOpen(false)}
              >
                {item.label}
              </NavLink>
            </div>

            {/* Children */}
            {item.children!.map((child, i) => {
              const childUrl = resolveUrl(child, orgSlug);
              return (
                <NavLink
                  key={i}
                  url={childUrl}
                  className="block px-4 py-2 text-sm text-parchment/70 hover:text-parchment hover:bg-parchment/5 transition-colors"
                  onClick={() => setIsOpen(false)}
                >
                  {child.label}
                </NavLink>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
