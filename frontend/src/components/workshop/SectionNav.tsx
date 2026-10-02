import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '../../lib/utils';

interface SectionNavItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  progress?: { filled: number; total: number };
}

interface SectionNavProps {
  sections: SectionNavItem[];
  /** Offset from top of viewport for intersection detection */
  offsetTop?: number;
  className?: string;
}

/**
 * Floating section navigation sidebar.
 * Highlights current section based on scroll position.
 */
export function SectionNav({ sections, offsetTop = 100, className }: SectionNavProps) {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  // Track scroll position and determine active section
  useEffect(() => {
    const handleScroll = () => {
      // Show nav only after scrolling a bit
      setIsVisible(window.scrollY > 200);

      // Find the section currently in view
      const sectionElements = sections
        .map((s) => document.getElementById(s.id))
        .filter(Boolean) as HTMLElement[];

      for (let i = sectionElements.length - 1; i >= 0; i--) {
        const el = sectionElements[i];
        const rect = el.getBoundingClientRect();
        if (rect.top <= offsetTop + 50) {
          setActiveSection(sections[i].id);
          return;
        }
      }

      // Default to first section if at top
      if (sectionElements.length > 0) {
        setActiveSection(sections[0].id);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Initial check

    return () => window.removeEventListener('scroll', handleScroll);
  }, [sections, offsetTop]);

  const scrollToSection = useCallback((sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      const y = element.getBoundingClientRect().top + window.scrollY - offsetTop;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  }, [offsetTop]);

  if (!isVisible) return null;

  return (
    <nav
      className={cn(
        'fixed right-6 top-1/2 -translate-y-1/2 z-30',
        'bg-parchment/90 backdrop-blur-sm rounded-lg shadow-lg border border-lichen/50',
        'p-2 transition-opacity duration-200',
        className
      )}
      aria-label="Section navigation"
    >
      <ul className="space-y-1">
        {sections.map((section) => {
          const isActive = activeSection === section.id;
          const isComplete = section.progress
            ? section.progress.filled === section.progress.total
            : false;

          return (
            <li key={section.id}>
              <button
                onClick={() => scrollToSection(section.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm transition-colors',
                  'hover:bg-stone/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2',
                  isActive
                    ? 'bg-azurite/10 text-azurite font-medium'
                    : 'text-archive hover:text-ink'
                )}
                aria-current={isActive ? 'true' : undefined}
              >
                {section.icon && (
                  <span className="flex-shrink-0 opacity-70">
                    {section.icon}
                  </span>
                )}
                <span className="truncate">{section.label}</span>
                {section.progress && (
                  <span
                    className={cn(
                      'ml-auto text-xs tabular-nums',
                      isComplete ? 'text-semantic-success' : 'text-archive'
                    )}
                  >
                    {section.progress.filled}/{section.progress.total}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
