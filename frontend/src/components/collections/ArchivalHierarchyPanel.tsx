import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, FolderTree, Plus } from 'lucide-react';
import { getFriendlyErrorMessage } from '../../lib/apiClient';
import {
  createChildRecord,
  downloadEad,
  getHierarchy,
  moveRecord,
  nextLevel,
} from '../../lib/api/hierarchy';
import type { HierarchyNode } from '../../lib/api/hierarchy';

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';
const fieldClass = `w-full px-3 py-2 text-sm border border-lichen rounded-lg bg-parchment text-ink ${focusRing} focus-visible:border-bark aria-[invalid=true]:border-semantic-error`;
const PAGE = 50;

function label(n: HierarchyNode) {
  return [n.level_label, n.object_number, n.title].filter(Boolean).join(' ');
}

interface Props {
  orgId: string;
  objectId: string;
  canEdit: boolean;
}

/**
 * Where a record sits in the archival hierarchy, and what it contains.
 *
 * Three routes through a hierarchy, because a tree alone is slow with a
 * screen reader: a breadcrumb of ancestors; a "Contents" table of children
 * with row headers, paging and Move up / Move down buttons (no drag and
 * drop); and an optional tree view following the WAI-ARIA tree pattern.
 */
export function ArchivalHierarchyPanel({ orgId, objectId, canEdit }: Props) {
  const id = useId();
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState('');
  const [showTree, setShowTree] = useState(false);
  const moveButtons = useRef<Record<string, HTMLButtonElement | null>>({});

  const q = useQuery({
    queryKey: ['hierarchy', orgId, objectId, offset],
    queryFn: () => getHierarchy(orgId, objectId, offset, PAGE),
  });
  const data = q.data;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['hierarchy', orgId] });

  const move = async (child: HierarchyNode, direction: 'up' | 'down') => {
    try {
      const r = await moveRecord(orgId, child.object_id, direction);
      setError('');
      setAnnouncement(`${label(child)} moved ${direction}, now ${r.position} of ${r.of}`);
      await refresh();
      // Keep focus on the same button of the moved row (or its pair at the edge).
      requestAnimationFrame(() => {
        const key = `${child.object_id}-${direction}`;
        const other = `${child.object_id}-${direction === 'up' ? 'down' : 'up'}`;
        const btn = moveButtons.current[key];
        (btn && !btn.disabled ? btn : moveButtons.current[other])?.focus();
      });
    } catch (e) {
      const m = getFriendlyErrorMessage(e);
      setError(m);
      setAnnouncement(m);
    }
  };

  if (q.isLoading || !data) return null;
  const { ancestors, node, children, children_total: total } = data;
  const isItem = node.catalog_level === 'item';
  const hasHierarchy = ancestors.length > 0 || total > 0 || !isItem;
  if (!hasHierarchy) return null;
  const root = ancestors[0] ?? node;

  return (
    <section aria-labelledby={`${id}-h`} className="bg-parchment-warm border border-lichen rounded-lg p-4 space-y-4">
      <h2 id={`${id}-h`} className="text-base font-semibold text-ink flex items-center gap-2">
        <FolderTree size={18} aria-hidden="true" className="text-forest" />
        Archival hierarchy
      </h2>
      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
      {error && <p className="text-sm text-semantic-error bg-semantic-error/10 rounded px-3 py-2">{error}</p>}

      {ancestors.length > 0 && (
        <nav aria-label="Archival hierarchy">
          <ol className="flex flex-wrap items-center gap-1 text-sm">
            {ancestors.map((a) => (
              <li key={a.object_id} className="flex items-center gap-1">
                <Link to={`/organizations/${orgId}/collections/objects/${a.object_id}`}
                  className={`text-bark hover:text-copper-dark underline underline-offset-2 rounded ${focusRing}`}>
                  {label(a)}
                </Link>
                <span aria-hidden="true" className="text-archive">/</span>
              </li>
            ))}
            <li aria-current="page" className="text-ink font-medium">{label(node)}</li>
          </ol>
        </nav>
      )}

      {total > 0 ? (
        <div>
          <table className="w-full text-sm border border-lichen rounded-lg overflow-hidden">
            <caption className="text-left text-sm font-semibold text-ink mb-2">
              Contents of {label(node)}: {total} {total === 1 ? 'record' : 'records'}
              {total > PAGE && `, showing ${offset + 1} to ${Math.min(offset + PAGE, total)}`}
            </caption>
            <thead className="bg-stone/50">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Title</th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Level</th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Number</th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Contains</th>
                {canEdit && <th scope="col" className="px-3 py-2 text-left font-medium text-ink">Order</th>}
              </tr>
            </thead>
            <tbody>
              {children.map((c, i) => {
                const position = offset + i + 1;
                return (
                  <tr key={c.object_id} className="border-t border-lichen">
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <Link to={`/organizations/${orgId}/collections/objects/${c.object_id}`}
                        className={`text-bark hover:text-copper-dark underline underline-offset-2 rounded ${focusRing}`}>
                        {c.title}
                      </Link>
                    </th>
                    <td className="px-3 py-2 text-ink">{c.level_label}</td>
                    <td className="px-3 py-2 text-ink">{c.object_number}</td>
                    <td className="px-3 py-2 text-ink">{c.child_count ? `${c.child_count} ${c.child_count === 1 ? 'record' : 'records'}` : 'None'}</td>
                    {canEdit && (
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <button type="button" ref={(el) => { moveButtons.current[`${c.object_id}-up`] = el; }}
                            disabled={position === 1} onClick={() => move(c, 'up')}
                            aria-label={`Move ${label(c)} up`}
                            className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-ink hover:bg-stone disabled:opacity-40 ${focusRing}`}>
                            <ArrowUp size={16} aria-hidden="true" />
                          </button>
                          <button type="button" ref={(el) => { moveButtons.current[`${c.object_id}-down`] = el; }}
                            disabled={position === total} onClick={() => move(c, 'down')}
                            aria-label={`Move ${label(c)} down`}
                            className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-ink hover:bg-stone disabled:opacity-40 ${focusRing}`}>
                            <ArrowDown size={16} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {total > PAGE && (
            <nav aria-label="Contents pages" className="mt-2 flex gap-2">
              <button type="button" className="btn-secondary text-sm" disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous {PAGE}</button>
              <button type="button" className="btn-secondary text-sm" disabled={offset + PAGE >= total}
                onClick={() => setOffset(offset + PAGE)}>Next {PAGE}</button>
            </nav>
          )}
        </div>
      ) : (
        !isItem && <p className="text-sm text-archive">This {node.level_label?.toLowerCase() ?? 'record'} contains no records yet.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {(ancestors.length > 0 || total > 0) && (
          <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1"
            aria-expanded={showTree} aria-controls={`${id}-tree`} onClick={() => setShowTree((v) => !v)}>
            <FolderTree size={14} aria-hidden="true" />
            {showTree ? 'Hide tree view' : 'Show tree view'}
          </button>
        )}
        {(root.catalog_level === 'collection' || node.catalog_level === 'collection') && (
          <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1"
            onClick={async () => {
              try {
                await downloadEad(orgId, root.object_id, `${root.object_number ?? 'finding-aid'}-ead3.xml`);
                setAnnouncement('EAD3 finding aid downloaded');
              } catch (e) {
                const m = getFriendlyErrorMessage(e);
                setError(m);
                setAnnouncement(m);
              }
            }}>
            <Download size={14} aria-hidden="true" />
            Download finding aid (EAD3) for {root.title}
          </button>
        )}
      </div>

      {showTree && (
        <div id={`${id}-tree`}>
          <HierarchyTree orgId={orgId} root={root} currentId={objectId} pathIds={[...ancestors.map((a) => a.object_id), objectId]} />
        </div>
      )}

      {canEdit && !isItem && (
        <AddChildForm orgId={orgId} parent={node} onCreated={(title) => {
          setError('');
          setAnnouncement(`${title} added to ${label(node)}`);
          refresh();
        }} onError={(m) => { setError(m); setAnnouncement(m); }} levels={data.levels} />
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function AddChildForm({
  orgId, parent, levels, onCreated, onError,
}: {
  orgId: string;
  parent: HierarchyNode;
  levels: { value: string; label: string }[];
  onCreated: (title: string) => void;
  onError: (message: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState(nextLevel(parent.catalog_level));
  const [number, setNumber] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const firstRef = useRef<HTMLSelectElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (open) firstRef.current?.focus(); }, [open]);

  if (!open) {
    return (
      <button ref={toggleRef} type="button" className="btn-tertiary text-sm inline-flex items-center gap-1" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden="true" />
        Add a record inside {label(parent)}
      </button>
    );
  }
  return (
    <form
      aria-labelledby={`${id}-h`}
      className="border border-lichen rounded-lg p-3 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const m = [!number.trim() && 'number', !title.trim() && 'title'].filter(Boolean) as string[];
        setMissing(m);
        if (m.length) {
          document.getElementById(`${id}-${m[0]}`)?.focus();
          return;
        }
        setBusy(true);
        try {
          await createChildRecord(orgId, parent.object_id, { object_number: number.trim(), title: title.trim(), catalog_level: level });
          onCreated(title.trim());
          setNumber('');
          setTitle('');
          firstRef.current?.focus();
        } catch (err) {
          onError(getFriendlyErrorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3 id={`${id}-h`} className="text-sm font-semibold text-ink">Add a record inside {label(parent)}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor={`${id}-level`} className="block text-sm font-medium text-ink mb-1">Level</label>
          <select ref={firstRef} id={`${id}-level`} value={level} onChange={(e) => setLevel(e.target.value)} className={fieldClass}>
            {levels.filter((l) => l.value !== 'collection').map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-number`} className="block text-sm font-medium text-ink mb-1">Number</label>
          <input id={`${id}-number`} value={number} onChange={(e) => setNumber(e.target.value)} autoComplete="off"
            aria-invalid={missing.includes('number')} aria-describedby={missing.includes('number') ? `${id}-number-err` : undefined}
            className={fieldClass} />
          {missing.includes('number') && <p id={`${id}-number-err`} className="mt-1 text-xs text-semantic-error">Enter a number for the record.</p>}
        </div>
        <div>
          <label htmlFor={`${id}-title`} className="block text-sm font-medium text-ink mb-1">Title</label>
          <input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off"
            aria-invalid={missing.includes('title')} aria-describedby={missing.includes('title') ? `${id}-title-err` : undefined}
            className={fieldClass} />
          {missing.includes('title') && <p id={`${id}-title-err`} className="mt-1 text-xs text-semantic-error">Enter a title.</p>}
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary text-sm" disabled={busy}>{busy ? 'Adding…' : 'Add record'}</button>
        <button type="button" className="btn-secondary text-sm" onClick={() => { setOpen(false); requestAnimationFrame(() => toggleRef.current?.focus()); }}>
          Close
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface TreeState {
  nodes: Record<string, HierarchyNode>;
  kids: Record<string, string[]>;
}

/**
 * WAI-ARIA tree view. Roving tabindex; Up/Down move through visible items,
 * Right expands or enters, Left collapses or goes to the parent, Home/End,
 * Enter opens the record. Children load when a branch is expanded.
 */
export function HierarchyTree({
  orgId, root, currentId, pathIds,
}: { orgId: string; root: HierarchyNode; currentId: string; pathIds: string[] }) {
  const navigate = useNavigate();
  const [state, setState] = useState<TreeState>({ nodes: { [root.object_id]: root }, kids: {} });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string>(currentId);
  const [status, setStatus] = useState('');
  const itemRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const pendingFocus = useRef<string | null>(null);

  const load = useCallback(async (nodeId: string) => {
    const r = await getHierarchy(orgId, nodeId, 0, 500);
    setState((s) => ({
      nodes: { ...s.nodes, [nodeId]: { ...r.node }, ...Object.fromEntries(r.children.map((c) => [c.object_id, c])) },
      kids: { ...s.kids, [nodeId]: r.children.map((c) => c.object_id) },
    }));
    return r.children.length;
  }, [orgId]);

  const pathKey = pathIds.join(',');
  // Open the path down to the current record on first render.
  useEffect(() => {
    const pathIds = pathKey ? pathKey.split(',') : [];
    let cancelled = false;
    (async () => {
      const toOpen = pathIds.slice(0, -1).length ? [root.object_id, ...pathIds.filter((p) => p !== root.object_id).slice(0, -1)] : [root.object_id];
      for (const nid of toOpen) {
        if (cancelled) return;
        await load(nid);
      }
      if (!cancelled) setExpanded(new Set(toOpen));
    })();
    return () => { cancelled = true; };
  }, [load, pathKey, root.object_id]);

  const visible = useMemo(() => {
    const out: { id: string; level: number; parent: string | null; setsize: number; pos: number }[] = [];
    const walk = (nid: string, level: number, parent: string | null, setsize: number, pos: number) => {
      out.push({ id: nid, level, parent, setsize, pos });
      if (expanded.has(nid)) {
        const ks = state.kids[nid] ?? [];
        ks.forEach((k, i) => walk(k, level + 1, nid, ks.length, i + 1));
      }
    };
    walk(root.object_id, 1, null, 1, 1);
    return out;
  }, [expanded, root.object_id, state.kids]);

  useEffect(() => {
    if (pendingFocus.current && itemRefs.current[pendingFocus.current]) {
      itemRefs.current[pendingFocus.current]?.focus();
      pendingFocus.current = null;
    }
  });

  const focusItem = (nid: string) => {
    setFocusId(nid);
    pendingFocus.current = nid;
  };

  const expand = async (nid: string) => {
    const n = state.nodes[nid];
    if (!n || !n.child_count) return;
    if (!state.kids[nid]) {
      setStatus(`Loading ${label(n)}`);
      const count = await load(nid);
      setStatus(`${label(n)} expanded, ${count} ${count === 1 ? 'item' : 'items'}`);
    } else {
      setStatus(`${label(n)} expanded`);
    }
    setExpanded((s) => new Set(s).add(nid));
  };
  const collapse = (nid: string) => {
    setExpanded((s) => { const t = new Set(s); t.delete(nid); return t; });
    const n = state.nodes[nid];
    if (n) setStatus(`${label(n)} collapsed`);
  };

  const onKeyDown = (e: React.KeyboardEvent, nid: string) => {
    const idx = visible.findIndex((v) => v.id === nid);
    const v = visible[idx];
    const n = state.nodes[nid];
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (idx < visible.length - 1) focusItem(visible[idx + 1].id);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (idx > 0) focusItem(visible[idx - 1].id);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (n?.child_count) {
          if (!expanded.has(nid)) expand(nid);
          else if (state.kids[nid]?.[0]) focusItem(state.kids[nid][0]);
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (expanded.has(nid)) collapse(nid);
        else if (v?.parent) focusItem(v.parent);
        break;
      case 'Home':
        e.preventDefault();
        focusItem(visible[0].id);
        break;
      case 'End':
        e.preventDefault();
        focusItem(visible[visible.length - 1].id);
        break;
      case 'Enter':
        e.preventDefault();
        navigate(`/organizations/${orgId}/collections/objects/${nid}`);
        break;
      default:
        if (e.key.length === 1 && /\S/.test(e.key)) {
          const ch = e.key.toLowerCase();
          const order = [...visible.slice(idx + 1), ...visible.slice(0, idx + 1)];
          const hit = order.find((x) => (state.nodes[x.id]?.title ?? '').toLowerCase().startsWith(ch));
          if (hit) focusItem(hit.id);
        }
    }
  };

  const renderItem = (nid: string): React.ReactNode => {
    const n = state.nodes[nid];
    const v = visible.find((x) => x.id === nid);
    if (!n || !v) return null;
    const isOpen = expanded.has(nid);
    const ks = isOpen ? state.kids[nid] ?? [] : [];
    return (
      <li
        key={nid}
        ref={(el) => { itemRefs.current[nid] = el; }}
        role="treeitem"
        aria-level={v.level}
        aria-setsize={v.setsize}
        aria-posinset={v.pos}
        aria-expanded={n.child_count ? isOpen : undefined}
        aria-selected={nid === currentId}
        aria-label={`${label(n)}${nid === currentId ? ', current record' : ''}`}
        tabIndex={nid === focusId ? 0 : -1}
        onKeyDown={(e) => { e.stopPropagation(); onKeyDown(e, nid); }}
        onFocus={(e) => { if (e.target === e.currentTarget) setFocusId(nid); }}
        className={`rounded ${focusRing}`}
      >
        {/* Pointer affordances; keyboard users use the tree keys, and clicks never steal focus order. */}
        <div className={`flex items-center gap-1 py-1 ${nid === currentId ? 'font-semibold text-ink' : 'text-ink'}`}>
          {n.child_count ? (
            // Pointer-only shortcut (aria-hidden); keyboard users press Right/Left on the treeitem.
            <span aria-hidden="true" className="inline-flex w-5 justify-center text-archive cursor-pointer"
              onClick={() => (isOpen ? collapse(nid) : expand(nid))}>
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          ) : <span aria-hidden="true" className="inline-block w-5" />}
          {/* Pointer-only shortcut (aria-hidden); keyboard users press Enter on the treeitem. */}
          <span aria-hidden="true" className="cursor-pointer hover:underline"
            onClick={() => navigate(`/organizations/${orgId}/collections/objects/${nid}`)}>
            {label(n)}
          </span>
        </div>
        {ks.length > 0 && (
          <ul role="group" className="ml-5">
            {ks.map((k) => renderItem(k))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div>
      <p id="hierarchy-tree-help" className="text-xs text-accessible-gray mb-2">
        Use the arrow keys to move through the tree, Right to open a branch, Left to close it, and Enter to open a record.
      </p>
      <ul role="tree" aria-label={`Hierarchy of ${label(root)}`} aria-describedby="hierarchy-tree-help" className="text-sm">
        {renderItem(root.object_id)}
      </ul>
      <div role="status" aria-live="polite" className="sr-only">{status}</div>
    </div>
  );
}
