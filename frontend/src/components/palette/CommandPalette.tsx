/**
 * Cmd+K command palette — fuzzy-first jump-to with Guide fallback.
 *
 * Sections (in order):
 *   1. **Recent** — last visits from WorkContext (only when the query is
 *      empty or the query has no strong nav matches)
 *   2. **Jump to** — fuzzy match over the shared nav catalog, filtered by
 *      the current user's permissions + app subscriptions
 *   3. **Ask Guide** — always the last row; hands the query off to the
 *      agent chat panel with the message pre-sent
 *
 * Keyboard:
 *   - ↑/↓ move selection
 *   - Enter activates the selected row
 *   - Esc closes
 *   - Type to filter
 *
 * The palette is portaled to document.body so stacking contexts in the
 * app shell (sticky headers, slide-overs, sidebars) can never clip it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { Search, ArrowRight, Clock, Sparkles, CornerDownLeft } from 'lucide-react';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { useAuth } from '../../hooks/useAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { useWork } from '../../contexts/WorkContext';
import { useAgentChatContext } from '../../contexts/AgentChatContext';
import {
  getNavCatalog,
  filterByAccess,
  resolveNavPath,
  type NavEntry,
} from '../../lib/navigationCatalog';
import { searchNavCatalog } from '../../lib/navigationSearch';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Unified result row — the keyboard navigation operates over a flat list
 * of these regardless of which section they came from. `kind` distinguishes
 * how to render and what to do on activation.
 */
type PaletteRow =
  | {
      kind: 'nav';
      id: string;
      label: string;
      sublabel: string;
      path: string;
      section: 'jump' | 'recent';
    }
  | {
      kind: 'ask-guide';
      id: 'ask-guide';
      label: string;
      sublabel: string;
    };

const MAX_RECENT = 5;
const MAX_NAV_RESULTS = 8;

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const { hasAppAccess } = useAuth();
  const { recentItems } = useWork();
  const { openChatWithMessage } = useAgentChatContext();

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const { modalRef, titleId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'command-palette',
  });

  // Build (once per open) the permission-filtered nav catalog. Doing this
  // inside useMemo keyed on the permission/app checker identity is overkill
  // — those change rarely and the catalog is ~80 entries. Keyed on `isOpen`
  // so reopening the palette picks up any mid-session permission changes.
  const allowedEntries = useMemo<NavEntry[]>(() => {
    if (!isOpen) return [];
    return filterByAccess(getNavCatalog(), { hasPermission, hasAppAccess });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Reset state on open/close
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIndex(0);
      // Small delay lets focus trap settle before we steal focus to the input.
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Keep active index in bounds as the result list shrinks during typing.
  const matchedNav = useMemo(
    () => searchNavCatalog(allowedEntries, query, { limit: MAX_NAV_RESULTS }),
    [allowedEntries, query],
  );

  const recentRows = useMemo<PaletteRow[]>(() => {
    // Only surface recents when the user hasn't typed anything meaningful.
    if (query.trim().length > 0) return [];
    return recentItems.slice(0, MAX_RECENT).map((item) => ({
      kind: 'nav' as const,
      id: `recent:${item.type}:${item.id}`,
      label: item.label,
      sublabel: item.sublabel || item.type.replace(/_/g, ' '),
      path: item.path,
      section: 'recent' as const,
    }));
  }, [query, recentItems]);

  const navRows = useMemo<PaletteRow[]>(
    () =>
      matchedNav.map((entry) => ({
        kind: 'nav' as const,
        id: entry.id,
        label: entry.label,
        sublabel: entry.breadcrumb.join(' / '),
        path: orgId ? resolveNavPath(entry, orgId) : entry.pathPattern,
        section: 'jump' as const,
      })),
    [matchedNav, orgId],
  );

  const askGuideRow = useMemo<PaletteRow>(() => {
    const trimmed = query.trim();
    return {
      kind: 'ask-guide',
      id: 'ask-guide',
      label: trimmed ? `Ask Guide: "${trimmed}"` : 'Ask Guide anything…',
      sublabel: trimmed
        ? 'Open the Guide chat with this question'
        : 'Open the Guide chat panel',
    };
  }, [query]);

  const rows = useMemo<PaletteRow[]>(
    () => [...recentRows, ...navRows, askGuideRow],
    [recentRows, navRows, askGuideRow],
  );

  // Clamp selection whenever the row list changes.
  useEffect(() => {
    setActiveIndex((prev) => {
      if (rows.length === 0) return 0;
      if (prev >= rows.length) return rows.length - 1;
      return prev;
    });
  }, [rows.length]);

  const activateRow = useCallback(
    (row: PaletteRow) => {
      if (row.kind === 'nav') {
        navigate(row.path);
        onClose();
        return;
      }
      // Ask Guide — hand the query to the agent chat context. Empty query
      // just opens the panel; non-empty auto-sends after the conversation
      // is created.
      const trimmed = query.trim();
      if (trimmed) {
        openChatWithMessage(trimmed);
      } else {
        openChatWithMessage('');
      }
      onClose();
    },
    [navigate, onClose, openChatWithMessage, query],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % Math.max(rows.length, 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + rows.length) % Math.max(rows.length, 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const row = rows[activeIndex];
        if (row) activateRow(row);
      }
    },
    [activeIndex, rows, activateRow],
  );

  // Scroll active row into view when keyboard-navigating past the fold.
  // JSDOM doesn't implement scrollIntoView, so we feature-detect to keep
  // component tests clean.
  useEffect(() => {
    const listEl = listRef.current;
    if (!listEl) return;
    const activeEl = listEl.querySelector<HTMLElement>(
      `[data-row-index="${activeIndex}"]`,
    );
    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  if (!isOpen) return null;

  const body = (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[10vh]"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId)}
        className="relative w-full max-w-xl rounded-lg bg-parchment shadow-2xl border border-lichen overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="sr-only">
          Command palette
        </h2>

        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-lichen">
          <Search size={18} className="text-archive flex-shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder="Jump to a page, or ask Guide…"
            className="flex-1 bg-transparent text-ink placeholder:text-archive outline-none text-sm"
            aria-label="Search or ask Guide"
            aria-controls="command-palette-results"
            aria-activedescendant={
              rows[activeIndex] ? `palette-row-${activeIndex}` : undefined
            }
            autoComplete="off"
            spellCheck="false"
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-archive border border-lichen rounded">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <ul
          ref={listRef}
          id="command-palette-results"
          role="listbox"
          aria-label="Command palette results"
          className="max-h-[60vh] overflow-y-auto py-2"
        >
          {recentRows.length > 0 && (
            <SectionHeader icon={Clock} label="Recent" />
          )}
          {recentRows.map((row, idx) => (
            <ResultRow
              key={row.id}
              row={row}
              index={idx}
              active={idx === activeIndex}
              onActivate={() => activateRow(row)}
              onHover={() => setActiveIndex(idx)}
            />
          ))}

          {navRows.length > 0 && (
            <SectionHeader
              icon={Search}
              label="Jump to"
              className={recentRows.length > 0 ? 'mt-2' : ''}
            />
          )}
          {navRows.map((row, idx) => {
            const flatIdx = recentRows.length + idx;
            return (
              <ResultRow
                key={row.id}
                row={row}
                index={flatIdx}
                active={flatIdx === activeIndex}
                onActivate={() => activateRow(row)}
                onHover={() => setActiveIndex(flatIdx)}
              />
            );
          })}

          <SectionHeader
            icon={Sparkles}
            label="Guide"
            className={recentRows.length > 0 || navRows.length > 0 ? 'mt-2' : ''}
          />
          {(() => {
            const flatIdx = recentRows.length + navRows.length;
            return (
              <ResultRow
                key="ask-guide"
                row={askGuideRow}
                index={flatIdx}
                active={flatIdx === activeIndex}
                onActivate={() => activateRow(askGuideRow)}
                onHover={() => setActiveIndex(flatIdx)}
              />
            );
          })()}

          {navRows.length === 0 && query.trim().length > 0 && (
            <li className="px-4 py-2 text-xs text-archive italic">
              No pages match "{query.trim()}" — try Ask Guide instead.
            </li>
          )}
        </ul>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-lichen flex items-center justify-between text-[10px] text-archive">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 border border-lichen rounded">↑</kbd>
              <kbd className="px-1 py-0.5 border border-lichen rounded">↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <CornerDownLeft size={10} />
              select
            </span>
          </div>
          <span>Cmd+K</span>
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

function SectionHeader({
  icon: Icon,
  label,
  className = '',
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  className?: string;
}) {
  return (
    <li
      className={`px-4 py-1 text-[10px] uppercase tracking-wide font-semibold text-archive flex items-center gap-1.5 ${className}`}
      aria-hidden="true"
    >
      <Icon size={11} />
      {label}
    </li>
  );
}

function ResultRow({
  row,
  index,
  active,
  onActivate,
  onHover,
}: {
  row: PaletteRow;
  index: number;
  active: boolean;
  onActivate: () => void;
  onHover: () => void;
}) {
  return (
    <li
      role="option"
      id={`palette-row-${index}`}
      data-row-index={index}
      aria-selected={active}
      onMouseMove={onHover}
      onClick={onActivate}
      className={`px-4 py-2 cursor-pointer flex items-center gap-3 ${
        active ? 'bg-bark/10' : 'hover:bg-stone/60'
      }`}
    >
      <div className="flex-shrink-0">
        {row.kind === 'ask-guide' ? (
          <Sparkles size={16} className="text-bark" aria-hidden="true" />
        ) : (
          <ArrowRight size={16} className="text-archive" aria-hidden="true" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-ink truncate">{row.label}</div>
        <div className="text-xs text-archive truncate">{row.sublabel}</div>
      </div>
      {active && (
        <CornerDownLeft size={12} className="text-archive flex-shrink-0" aria-hidden="true" />
      )}
    </li>
  );
}
