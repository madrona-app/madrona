/**
 * AuthorityAutocomplete Component
 *
 * A smart autocomplete for CDWA reference fields that seamlessly integrates
 * external reference sources while keeping the experience simple.
 *
 * Design principles:
 * - Works offline (local suggestions always available)
 * - Authorities are optional (users can ignore them) unless the organization
 *   has switched the field to strict vocabulary validation
 * - No jargon (users see "verified" not "linked data")
 * - Progressive enhancement (basic → local → external)
 *
 * Accessibility: follows the WAI-ARIA combobox pattern with a listbox popup —
 * role="combobox" input with aria-expanded / aria-controls /
 * aria-activedescendant, a grouped listbox (role="group" + role="option"),
 * a polite live region announcing the result count, Escape to close, and
 * focus that never leaves the input while moving through options.
 */

import React, { forwardRef, useId, useRef, useState, useLayoutEffect, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, Clock, Building2, Check, Loader2, WifiOff, Plus } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useOrganization } from '../../../contexts/useOrganization';
import { useIsStrictVocabularyField } from '../../../hooks/useVocabularyValidation';
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
 * Icon for suggestion source (decorative; the group label says the same).
 */
function SourceIcon({ source }: { source: SuggestionSource }) {
  switch (source) {
    case 'recent':
      return <Clock size={14} className="text-archive shrink-0 mt-1" aria-hidden="true" />;
    case 'organization':
      return <Building2 size={14} className="text-forest shrink-0 mt-1" aria-hidden="true" />;
    default:
      return null;
  }
}

/**
 * Badge showing where a suggestion came from.
 */
function SourceBadge({ suggestion }: { suggestion: AutocompleteSuggestion }) {
  if (suggestion.source === 'recent') {
    return null;
  }

  if (suggestion.source === 'organization') {
    return (
      <span className="text-xs text-forest bg-forest/10 px-1.5 py-0.5 rounded">
        Used in collection
      </span>
    );
  }

  if (suggestion.reference) {
    const label = REFERENCE_SOURCE_LABELS[suggestion.reference.source] || suggestion.reference.source;
    return (
      <span className="text-xs text-accessible-gray bg-stone px-1.5 py-0.5 rounded">
        {label}
      </span>
    );
  }

  return null;
}

/**
 * A single suggestion option.
 */
function SuggestionItem({
  id,
  suggestion,
  isHighlighted,
  onSelect,
  onMouseEnter,
}: {
  id: string;
  suggestion: AutocompleteSuggestion;
  isHighlighted: boolean;
  onSelect: () => void;
  onMouseEnter: () => void;
}) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={isHighlighted}
      // Keep focus in the input so the combobox stays the focused element
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
      className={cn(
        'px-3 py-2 cursor-pointer transition-colors',
        isHighlighted ? 'bg-bark/10 outline outline-2 -outline-offset-2 outline-bark/40' : 'hover:bg-stone/50'
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
        </div>
      </div>
    </li>
  );
}

/**
 * A labelled group of options inside the listbox.
 */
function SuggestionGroup({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <ul role="group" aria-labelledby={id}>
      <li
        role="presentation"
        id={id}
        className="px-3 py-1.5 text-xs font-medium text-accessible-gray uppercase tracking-wide"
      >
        {label}
      </li>
      {children}
    </ul>
  );
}

function pluralSuggestions(n: number): string {
  return n === 1 ? '1 suggestion' : `${n} suggestions`;
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
    strictField,
    describedBy,
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
  const statusId = `${id}-status`;
  const strictHintId = `${id}-strict-hint`;
  const verifiedId = `${id}-verified`;
  const optionId = (index: number) => `${id}-option-${index}`;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });

  const { activeOrganizationId } = useOrganization();
  const organizationId = activeOrganizationId || '';
  const isStrict = useIsStrictVocabularyField(organizationId, strictField);

  const {
    inputValue,
    isOpen,
    suggestions,
    highlightedIndex,
    setHighlightedIndex,
    isLoading,
    isOffline,
    notice,
    showCreateOption,
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
    allowCreate,
    strict: isStrict,
    strictField,
  });

  // Group suggestions by source for display
  const recentSuggestions = suggestions.filter((s) => s.source === 'recent');
  const orgSuggestions = suggestions.filter((s) => s.source === 'organization' || s.source === 'vocabulary');
  const externalSuggestions = suggestions.filter(
    (s) => !['recent', 'organization', 'vocabulary'].includes(s.source)
  );
  // Display order must match keyboard order
  const ordered = [...recentSuggestions, ...orgSuggestions, ...externalSuggestions];
  const indexOf = (s: AutocompleteSuggestion) => ordered.indexOf(s);
  const createIndex = ordered.length;

  const hasReference = !!(value?.authorities && value.authorities.length > 0);
  const query = inputValue.trim();
  const listboxVisible = isOpen && !disabled && (ordered.length > 0 || showCreateOption);
  const panelVisible = isOpen && !disabled && (listboxVisible || isLoading || query.length >= 2);

  const activeDescendant =
    listboxVisible && highlightedIndex >= 0 && highlightedIndex <= createIndex
      ? (highlightedIndex === createIndex ? (showCreateOption ? optionId(createIndex) : undefined) : optionId(highlightedIndex))
      : undefined;

  // Screen-reader status: result count, searching, or why nothing happened
  let statusMessage = '';
  if (notice) {
    statusMessage = notice;
  } else if (isOpen && !disabled) {
    if (isLoading && ordered.length === 0) {
      statusMessage = 'Searching reference sources.';
    } else if (ordered.length > 0) {
      statusMessage = `${pluralSuggestions(ordered.length)} available. Use the up and down arrow keys to review, Enter to choose.`;
    } else if (query.length >= 2) {
      statusMessage = isStrict
        ? 'No matching terms. This field only accepts terms from your vocabulary or a reference source.'
        : 'No matches. Press Enter to use your entry as typed.';
    }
  }


  const updateDropdownPosition = useCallback(() => {
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setDropdownPosition({ top: rect.bottom, left: rect.left, width: rect.width });
    }
  }, []);

  // Fixed positioning with viewport-relative coords for custom scroll containers
  useLayoutEffect(() => {
    if (isOpen) {
      updateDropdownPosition();
    }
  }, [isOpen, inputValue, updateDropdownPosition]);

  useEffect(() => {
    if (!isOpen) return;
    const handleScroll = () => updateDropdownPosition();
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [isOpen, updateDropdownPosition]);

  // Keep the highlighted option scrolled into view
  useEffect(() => {
    if (!activeDescendant) return;
    const el = document.getElementById(activeDescendant);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [activeDescendant]);

  const renderItem = (s: AutocompleteSuggestion) => {
    const index = indexOf(s);
    return (
      <SuggestionItem
        key={s.id}
        id={optionId(index)}
        suggestion={s}
        isHighlighted={highlightedIndex === index}
        onSelect={() => handleSelect(s)}
        onMouseEnter={() => setHighlightedIndex(index)}
      />
    );
  };

  const dropdownContent = panelVisible && (
    <div
      style={{
        position: 'fixed',
        top: dropdownPosition.top,
        left: dropdownPosition.left,
        width: dropdownPosition.width,
      }}
      className="z-[9999] bg-parchment border border-lichen rounded-lg shadow-lg max-h-80 overflow-y-auto"
    >
      {listboxVisible && (
        <div
          role={getMenuProps().role}
          id={menuId}
          aria-label={ariaLabel ? `${ariaLabel} suggestions` : `${fieldType} suggestions`}
        >
          {recentSuggestions.length > 0 && (
            <SuggestionGroup id={`${id}-group-recent`} label="Recently used">
              {recentSuggestions.map(renderItem)}
            </SuggestionGroup>
          )}
          {orgSuggestions.length > 0 && (
            <SuggestionGroup id={`${id}-group-org`} label="From your collection">
              {orgSuggestions.map(renderItem)}
            </SuggestionGroup>
          )}
          {externalSuggestions.length > 0 && (
            <SuggestionGroup id={`${id}-group-external`} label="Reference sources">
              {externalSuggestions.map(renderItem)}
            </SuggestionGroup>
          )}
          {showCreateOption && (
            <div
              id={optionId(createIndex)}
              role="option"
              aria-selected={highlightedIndex === createIndex}
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCreateNew}
              onMouseEnter={() => setHighlightedIndex(createIndex)}
              className={cn(
                'px-3 py-2 cursor-pointer transition-colors border-t border-lichen',
                highlightedIndex === createIndex ? 'bg-bark/10 outline outline-2 -outline-offset-2 outline-bark/40' : 'hover:bg-stone/50'
              )}
            >
              <div className="flex items-center gap-2 text-bark">
                <Plus size={14} aria-hidden="true" />
                <span>Use &ldquo;{query}&rdquo; as entered</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Visual status inside the panel; announced via the live region instead */}
      {isLoading && ordered.length === 0 && (
        <div className="px-3 py-2 text-sm text-archive flex items-center gap-2" aria-hidden="true">
          <Loader2 size={14} className="animate-spin" />
          <span>Searching reference sources...</span>
        </div>
      )}
      {!isLoading && ordered.length === 0 && query.length >= 2 && (
        <div className="px-3 py-2 text-sm text-archive" aria-hidden="true">
          {isStrict
            ? 'No matching terms in your vocabulary or reference sources'
            : 'No matches found — you can still use your entry'}
        </div>
      )}
    </div>
  );

  const inputProps = getInputProps();
  const describedByIds = [
    isStrict ? strictHintId : null,
    hasReference && showVerifiedBadge && !isOpen ? verifiedId : null,
    describedBy || null,
  ].filter(Boolean).join(' ') || undefined;

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true">
          {isLoading ? (
            <Loader2 size={16} className="text-archive animate-spin" />
          ) : (
            <Search size={16} className="text-archive" />
          )}
        </div>

        <input
          {...inputProps}
          role="combobox"
          ref={ref}
          id={id}
          name={name}
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          aria-label={ariaLabel || `Search ${fieldType}`}
          aria-expanded={listboxVisible}
          aria-controls={listboxVisible ? menuId : undefined}
          aria-activedescendant={activeDescendant}
          aria-describedby={describedByIds}
          className={cn(
            'w-full pl-9 pr-10 py-2 border rounded-lg',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark',
            'placeholder:text-archive/60',
            disabled && 'bg-stone/50 cursor-not-allowed',
            hasReference && showVerifiedBadge && 'border-semantic-success/50',
            !hasReference && 'border-lichen'
          )}
        />

        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {isOffline && (
            <span title="Working offline - showing local suggestions only">
              <WifiOff size={14} className="text-archive" aria-hidden="true" />
              <span className="sr-only">Working offline, showing local suggestions only</span>
            </span>
          )}
          {hasReference && showVerifiedBadge && (
            <span title="Verified in reference sources" aria-hidden="true">
              <Check size={14} className="text-semantic-success" />
            </span>
          )}
        </div>
      </div>

      {isStrict && (
        <p id={strictHintId} className="mt-1 text-xs text-accessible-gray">
          Strict vocabulary: new terms can&rsquo;t be added here. Type to search, then choose a term
          from your vocabulary or a reference source.
        </p>
      )}

      {hasReference && showVerifiedBadge && !isOpen && (
        <div id={verifiedId} className="mt-1 text-xs text-semantic-success flex items-center gap-1">
          <Check size={12} aria-hidden="true" />
          <span>Verified in reference sources</span>
        </div>
      )}

      {/* Polite live region: always rendered so updates are announced */}
      <div id={statusId} role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {statusMessage}
      </div>

      {/* Dropdown rendered via portal to escape overflow:hidden containers */}
      {dropdownContent && createPortal(dropdownContent, document.body)}
    </div>
  );
});

export default AuthorityAutocomplete;
