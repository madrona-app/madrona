/**
 * AuthorityAutocomplete Component
 *
 * A smart autocomplete for CDWA reference fields that seamlessly integrates
 * external reference sources while keeping the experience simple.
 *
 * Design principles:
 * - Works offline (local suggestions always available)
 * - Authorities are optional (users can ignore them)
 * - No jargon (users see "verified" not "linked data")
 * - Progressive enhancement (basic → local → external)
 */

import React, { forwardRef, useId, useRef, useState, useLayoutEffect, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, Clock, Building2, Check, Loader2, WifiOff, Plus, ExternalLink } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useOrganization } from '../../../contexts/useOrganization';
import { useAutocomplete } from './useAutocomplete';
import type {
  AuthorityAutocompleteProps,
  AutocompleteSuggestion,
  SuggestionSource,
} from './types';
import { REFERENCE_SOURCE_LABELS } from './types';

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

/**
 * Icon for suggestion source.
 */
function SourceIcon({ source }: { source: SuggestionSource }) {
  switch (source) {
    case 'recent':
      return <Clock size={14} className="text-archive" />;
    case 'organization':
      return <Building2 size={14} className="text-forest" />;
    default:
      return null;
  }
}

/**
 * Badge showing where a suggestion came from.
 */
function SourceBadge({ suggestion }: { suggestion: AutocompleteSuggestion }) {
  // Recent entries don't need a badge
  if (suggestion.source === 'recent') {
    return null;
  }

  // Organization entries
  if (suggestion.source === 'organization') {
    return (
      <span className="text-xs text-forest bg-forest/10 px-1.5 py-0.5 rounded">
        Used in collection
      </span>
    );
  }

  // External sources
  if (suggestion.reference) {
    const label = REFERENCE_SOURCE_LABELS[suggestion.reference.source] || suggestion.reference.source;
    return (
      <span className="text-xs text-archive bg-stone px-1.5 py-0.5 rounded">
        {label}
      </span>
    );
  }

  return null;
}

/**
 * Section header in the dropdown.
 */
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-1.5 text-xs font-medium text-archive uppercase tracking-wide">
      {children}
    </div>
  );
}

/**
 * A single suggestion item.
 */
function SuggestionItem({
  suggestion,
  isHighlighted,
  onClick,
  onMouseEnter,
}: {
  suggestion: AutocompleteSuggestion;
  isHighlighted: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  return (
    <li
      role="option"
      aria-selected={isHighlighted}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={cn(
        'px-3 py-2 cursor-pointer transition-colors',
        isHighlighted ? 'bg-bark/10' : 'hover:bg-stone/50'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <SourceIcon source={suggestion.source} />
          <div className="min-w-0">
            <div className="font-medium text-ink truncate">
              {suggestion.label}
            </div>
            {suggestion.description && (
              <div className="text-sm text-archive truncate">
                {suggestion.description}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <SourceBadge suggestion={suggestion} />
          {suggestion.reference?.uri && (
            <a
              href={suggestion.reference.uri}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-archive hover:text-bark p-0.5"
              title={`View in ${REFERENCE_SOURCE_LABELS[suggestion.reference.source] || suggestion.reference.source}`}
            >
              <ExternalLink size={12} />
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * "Use as entered" option at the bottom.
 */
function CreateNewItem({
  value,
  isHighlighted,
  onClick,
  onMouseEnter,
}: {
  value: string;
  isHighlighted: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  return (
    <li
      role="option"
      aria-selected={isHighlighted}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={cn(
        'px-3 py-2 cursor-pointer transition-colors border-t border-lichen',
        isHighlighted ? 'bg-bark/10' : 'hover:bg-stone/50'
      )}
    >
      <div className="flex items-center gap-2 text-bark">
        <Plus size={14} />
        <span>Use "{value}" as entered</span>
      </div>
    </li>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const AuthorityAutocomplete = forwardRef<
  HTMLInputElement,
  AuthorityAutocompleteProps
>(function AuthorityAutocomplete(
  {
    fieldType,
    value,
    onChange,
    placeholder,
    disabled = false,
    required = false,
    context: _context,
    showVerifiedBadge = true,
    maxSuggestions = 8,
    debounceMs = 300,
    allowCreate = true,
    className,
    ariaLabel,
    id: propId,
    name,
  },
  ref
) {
  const generatedId = useId();
  const id = propId || generatedId;
  const menuId = `${id}-menu`;

  // Refs for portal positioning
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });

  // Get organization ID from context
  const { activeOrganizationId } = useOrganization();
  const organizationId = activeOrganizationId || '';

  const {
    inputValue,
    isOpen,
    suggestions,
    highlightedIndex,
    setHighlightedIndex,
    isLoading,
    isOffline,
    handleSelect,
    handleCreateNew,
    getInputProps,
    getMenuProps,
  } = useAutocomplete({
    fieldType,
    organizationId,
    initialValue: value?.value || '',
    maxSuggestions,
    debounceMs,
    onSelect: onChange,
  });

  // Group suggestions by source for display
  const recentSuggestions = suggestions.filter((s) => s.source === 'recent');
  const orgSuggestions = suggestions.filter((s) => s.source === 'organization');
  const externalSuggestions = suggestions.filter(
    (s) => !['recent', 'organization'].includes(s.source)
  );

  // Track index across all groups
  let currentIndex = 0;
  const getIndexAndIncrement = () => currentIndex++;

  // Determine if we have a verified value
  const hasReference = value?.authorities && value.authorities.length > 0;

  // Update dropdown position
  const updateDropdownPosition = useCallback(() => {
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom,
        left: rect.left,
        width: rect.width,
      });
    }
  }, []);

  // Calculate dropdown position when open
  // Use fixed positioning with viewport-relative coords for compatibility with custom scroll containers
  useLayoutEffect(() => {
    if (isOpen) {
      updateDropdownPosition();
    }
  }, [isOpen, inputValue, updateDropdownPosition]);

  // Update position on scroll (for fixed positioning)
  useEffect(() => {
    if (!isOpen) return;

    // Listen to scroll events on window and any scroll containers
    const handleScroll = () => {
      updateDropdownPosition();
    };

    // Capture scroll events from any element (including custom scroll containers)
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);

    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [isOpen, updateDropdownPosition]);

  // Dropdown content - rendered via portal with fixed positioning
  const dropdownContent = isOpen && (inputValue.trim() || suggestions.length > 0) && (
    <ul
      {...getMenuProps()}
      id={menuId}
      style={{
        position: 'fixed',
        top: dropdownPosition.top,
        left: dropdownPosition.left,
        width: dropdownPosition.width,
      }}
      className={cn(
        'z-[9999] bg-parchment border border-lichen rounded-lg shadow-lg',
        'max-h-80 overflow-y-auto'
      )}
    >
      {/* Recent suggestions */}
      {recentSuggestions.length > 0 && (
        <>
          <SectionHeader>Recently Used</SectionHeader>
          {recentSuggestions.map((suggestion) => {
            const index = getIndexAndIncrement();
            return (
              <SuggestionItem
                key={suggestion.id}
                suggestion={suggestion}
                isHighlighted={highlightedIndex === index}
                onClick={() => handleSelect(suggestion)}
                onMouseEnter={() => setHighlightedIndex(index)}
              />
            );
          })}
        </>
      )}

      {/* Organization suggestions */}
      {orgSuggestions.length > 0 && (
        <>
          <SectionHeader>From Your Collection</SectionHeader>
          {orgSuggestions.map((suggestion) => {
            const index = getIndexAndIncrement();
            return (
              <SuggestionItem
                key={suggestion.id}
                suggestion={suggestion}
                isHighlighted={highlightedIndex === index}
                onClick={() => handleSelect(suggestion)}
                onMouseEnter={() => setHighlightedIndex(index)}
              />
            );
          })}
        </>
      )}

      {/* External suggestions */}
      {externalSuggestions.length > 0 && (
        <>
          <SectionHeader>Reference Sources</SectionHeader>
          {externalSuggestions.map((suggestion) => {
            const index = getIndexAndIncrement();
            return (
              <SuggestionItem
                key={suggestion.id}
                suggestion={suggestion}
                isHighlighted={highlightedIndex === index}
                onClick={() => handleSelect(suggestion)}
                onMouseEnter={() => setHighlightedIndex(index)}
              />
            );
          })}
        </>
      )}

      {/* Loading indicator */}
      {isLoading && externalSuggestions.length === 0 && (
        <div className="px-3 py-2 text-sm text-archive flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          <span>Searching reference sources...</span>
        </div>
      )}

      {/* No results message */}
      {!isLoading &&
        suggestions.length === 0 &&
        inputValue.trim().length >= 2 && (
          <div className="px-3 py-2 text-sm text-archive">
            No matches found — you can still use your entry
          </div>
        )}

      {/* Create new option */}
      {allowCreate && inputValue.trim() && (
        <CreateNewItem
          value={inputValue.trim()}
          isHighlighted={highlightedIndex === currentIndex}
          onClick={handleCreateNew}
          onMouseEnter={() => setHighlightedIndex(currentIndex)}
        />
      )}
    </ul>
  );

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      {/* Input wrapper */}
      <div className="relative">
        {/* Search icon */}
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
          {isLoading ? (
            <Loader2 size={16} className="text-archive animate-spin" />
          ) : (
            <Search size={16} className="text-archive" />
          )}
        </div>

        {/* Input */}
        <input
          {...getInputProps()}
          ref={ref}
          id={id}
          name={name}
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          aria-label={ariaLabel || `Search ${fieldType}`}
          aria-controls={menuId}
          className={cn(
            'w-full pl-9 pr-4 py-2 border rounded-lg',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark',
            'placeholder:text-archive/60',
            disabled && 'bg-stone/50 cursor-not-allowed',
            hasReference && showVerifiedBadge && 'border-semantic-success/50',
            !hasReference && 'border-lichen'
          )}
        />

        {/* Right side indicators */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {/* Offline indicator */}
          {isOffline && (
            <span title="Working offline - showing local suggestions only">
              <WifiOff
                size={14}
                className="text-archive"
              />
            </span>
          )}

          {/* Verified indicator */}
          {hasReference && showVerifiedBadge && (
            <span title="Verified in reference sources">
              <Check
                size={14}
                className="text-semantic-success"
              />
            </span>
          )}
        </div>
      </div>

      {/* Verified badge below input */}
      {hasReference && showVerifiedBadge && !isOpen && (
        <div className="mt-1 text-xs text-semantic-success flex items-center gap-1">
          <Check size={12} />
          <span>Verified in reference sources</span>
        </div>
      )}

      {/* Dropdown rendered via portal to escape overflow:hidden containers */}
      {dropdownContent && createPortal(dropdownContent, document.body)}
    </div>
  );
});

export default AuthorityAutocomplete;
