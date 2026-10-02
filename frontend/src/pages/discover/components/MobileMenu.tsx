/**
 * MobileMenu — Slide-out mobile navigation panel for the public collection site.
 *
 * Renders a full-screen overlay with a left-sliding panel containing the
 * site navigation. Supports nested accordion items, URL resolution by
 * link_type, focus trapping, and keyboard dismissal.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { X, ChevronDown, Search } from 'lucide-react';
import type { PublicMenuItem } from '../../../types/content';

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  items: PublicMenuItem[];
  orgSlug: string;
}

function resolveUrl(item: PublicMenuItem, orgSlug: string): string {
  switch (item.link_type) {
    case 'page':
      return item.page_slug ? `/c/${orgSlug}/pages/${item.page_slug}` : '#';
    case 'collection':
      return `/c/${orgSlug}`;
    case 'category':
      return item.url ? `/c/${orgSlug}/blog?category=${item.url}` : '#';
    case 'exhibition':
      return item.url ? `/c/${orgSlug}/exhibitions/${item.url}` : '#';
    case 'event':
      return item.url ? `/c/${orgSlug}/events/${item.url}` : '#';
    case 'url':
    default:
      return item.url || '#';
  }
}

function isExternal(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

function MenuLink({
  item,
  orgSlug,
  onClose,
  className,
}: {
  item: PublicMenuItem;
  orgSlug: string;
  onClose: () => void;
  className?: string;
}) {
  const url = resolveUrl(item, orgSlug);
  const external = isExternal(url);

  const classes =
    className ??
    'block w-full px-6 py-3 text-sm text-parchment/70 hover:bg-parchment/10 hover:text-parchment transition-colors';

  if (external) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={classes}
        onClick={onClose}
      >
        {item.label}
      </a>
    );
  }

  return (
    <Link to={url} className={classes} onClick={onClose}>
      {item.label}
    </Link>
  );
}

function AccordionItem({
  item,
  orgSlug,
  onClose,
}: {
  item: PublicMenuItem;
  orgSlug: string;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = item.children && item.children.length > 0;

  if (!hasChildren) {
    return <MenuLink item={item} orgSlug={orgSlug} onClose={onClose} />;
  }

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-6 py-3 text-sm text-parchment/70 hover:bg-parchment/10 hover:text-parchment transition-colors"
        aria-expanded={expanded}
      >
        <span>{item.label}</span>
        <ChevronDown
          size={16}
          className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      <div
        className={`overflow-hidden transition-all duration-200 ${
          expanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        {/* Parent link inside accordion */}
        <MenuLink
          item={item}
          orgSlug={orgSlug}
          onClose={onClose}
          className="block w-full pl-10 pr-6 py-2.5 text-sm text-parchment/70 hover:bg-parchment/10 hover:text-parchment transition-colors"
        />

        {/* Child items */}
        {item.children!.map((child, i) => (
          <MenuLink
            key={i}
            item={child}
            orgSlug={orgSlug}
            onClose={onClose}
            className="block w-full pl-10 pr-6 py-2.5 text-sm text-parchment/70 hover:bg-parchment/10 hover:text-parchment transition-colors"
          />
        ))}
      </div>
    </div>
  );
}

export function MobileMenu({ isOpen, onClose, items, orgSlug }: MobileMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Focus trap: move focus into panel when opened, restore when closed
  useEffect(() => {
    if (!isOpen) return;

    // Focus the close button when the menu opens
    const timer = setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 50);

    return () => clearTimeout(timer);
  }, [isOpen]);

  // Focus trap: keep focus within the panel
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Tab' || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    []
  );

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  return (
    <div
      className={`fixed inset-0 z-50 ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
      aria-hidden={!isOpen}
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-ink/50 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Mobile navigation"
        onKeyDown={handleKeyDown}
        className={`absolute inset-y-0 left-0 w-full max-w-[320px] bg-forest flex flex-col transform transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header with close button */}
        <div className="flex items-center justify-end px-4 py-3 border-b border-parchment/10">
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close navigation menu"
            className="p-2 text-parchment/70 hover:text-parchment hover:bg-parchment/10 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation items */}
        <nav className="flex-1 overflow-y-auto py-2">
          {items.map((item, i) => (
            <AccordionItem
              key={i}
              item={item}
              orgSlug={orgSlug}
              onClose={onClose}
            />
          ))}

          {/* Divider */}
          <div className="border-t border-parchment/10 my-2" />

          {/* Search link */}
          <Link
            to={`/c/${orgSlug}`}
            onClick={onClose}
            className="flex items-center gap-3 px-6 py-3 text-sm text-parchment/70 hover:bg-parchment/10 hover:text-parchment transition-colors"
          >
            <Search size={16} />
            <span>Search the collection</span>
          </Link>
        </nav>
      </div>
    </div>
  );
}
