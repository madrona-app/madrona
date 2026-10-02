import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Sparkles, Trash2 } from 'lucide-react';

import { SlideOver } from '@/components/ui/SlideOver';
import type { SectionGroup, SectionDefinition } from '@/components/record-detail/SectionNav';
import type { FormLayoutDelta } from '@/lib/layout/resolveLayout';
import {
  listLayoutOverrides,
  createLayoutOverride,
  updateLayoutOverride,
  activateLayoutOverride,
  deactivateLayoutOverride,
  deleteLayoutOverride,
  suggestLayoutOverride,
  type LayoutSectionCatalogItem,
} from '@/lib/api/layoutOverrides';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  surfaceKey: string;
  /** Base layout — drives the editor list and the AI section catalog. */
  groups: SectionGroup[];
}

const DEFAULT = '__default__';

const isRequired = (s: SectionDefinition): boolean =>
  s.isRequired === true || (s.requiredFields?.length ?? 0) > 0;

export function LayoutCustomizerSlideOver({ isOpen, onClose, surfaceKey, groups }: Props) {
  const queryClient = useQueryClient();
  const queryKey = ['layout-overrides', surfaceKey, null];

  const { data: variants = [] } = useQuery({
    queryKey,
    queryFn: () => listLayoutOverrides({ surfaceKey }),
    enabled: isOpen,
  });

  const [selected, setSelected] = useState<string>(DEFAULT);
  const [name, setName] = useState('');
  const [delta, setDelta] = useState<FormLayoutDelta>({});
  const [instruction, setInstruction] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Load the chosen variant (or Default) into the editor.
  const selectVariant = (id: string) => {
    setSelected(id);
    setError(null);
    if (id === DEFAULT) {
      setName('');
      setDelta({});
      return;
    }
    const v = variants.find((o) => o.id === id);
    if (v) {
      setName(v.name);
      setDelta(v.delta ?? {});
    }
  };

  const catalog: LayoutSectionCatalogItem[] = useMemo(
    () =>
      groups.flatMap((g) =>
        g.sections.map((s) => ({
          id: s.id,
          label: s.label,
          group: g.id,
          required: isRequired(s),
        }))
      ),
    [groups]
  );

  const hidden = new Set(delta.hidden_sections ?? []);
  const toggle = (id: string) => {
    setDelta((d) => {
      const next = new Set(d.hidden_sections ?? []);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { ...d, hidden_sections: [...next] };
    });
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['layout-overrides', surfaceKey] });

  const suggest = useMutation({
    mutationFn: () =>
      suggestLayoutOverride({ surface_key: surfaceKey, instruction: instruction.trim(), sections: catalog }),
    onSuccess: (d) => {
      setDelta(d);
      setError(null);
    },
    onError: () => setError('Could not generate a layout from that description.'),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (selected === DEFAULT) {
        return createLayoutOverride({ surface_key: surfaceKey, name: name.trim(), delta, make_active: true });
      }
      await updateLayoutOverride(selected, { name: name.trim(), delta });
      return activateLayoutOverride(selected);
    },
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
    onError: () => setError('Could not save the layout.'),
  });

  const remove = useMutation({
    mutationFn: () => deleteLayoutOverride(selected),
    onSuccess: async () => {
      await invalidate();
      selectVariant(DEFAULT);
    },
    onError: () => setError('Could not delete the layout.'),
  });

  // Switch the page back to the default (no active variant).
  const useDefault = useMutation({
    mutationFn: () => deactivateLayoutOverride({ surface_key: surfaceKey }),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
    onError: () => setError('Could not switch to the default layout.'),
  });

  const busy =
    suggest.isPending || save.isPending || remove.isPending || useDefault.isPending;

  // Primary action depends on context: a selected variant updates; Default with
  // a name creates a new variant; Default with no name switches back to default.
  const mode: 'update' | 'create' | 'default' =
    selected !== DEFAULT ? 'update' : name.trim() ? 'create' : 'default';
  const primary = {
    update: { label: 'Update & activate', run: () => save.mutate() },
    create: { label: 'Save & activate', run: () => save.mutate() },
    default: { label: 'Use default', run: () => useDefault.mutate() },
  }[mode];

  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm">
        Cancel
      </button>
      <button
        type="button"
        onClick={primary.run}
        disabled={busy || (mode !== 'default' && !name.trim())}
        className="btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {primary.label}
      </button>
    </div>
  );

  return (
    <SlideOver
      isOpen={isOpen}
      onClose={onClose}
      title="Customize layout"
      subtitle="Show, hide, and name section layouts — or describe the layout you want."
      width="md"
      footer={footer}
    >
      <div className="flex flex-col gap-6">
        {/* Variant switcher */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Layout</label>
          <div className="flex items-center gap-2">
            <select
              value={selected}
              onChange={(e) => selectVariant(e.target.value)}
              className="flex-1 rounded-md border border-lichen bg-parchment px-3 py-2 text-sm text-ink"
            >
              <option value={DEFAULT}>Default</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.is_active ? ' (active)' : ''}
                </option>
              ))}
            </select>
            {selected !== DEFAULT && (
              <button
                type="button"
                onClick={() => remove.mutate()}
                disabled={busy}
                aria-label="Delete layout"
                className="text-archive hover:text-semantic-error p-2"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </div>

        {/* AI box */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Describe your layout</label>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={2}
            placeholder="e.g. Hide valuations and rights, and move condition near the top"
            className="w-full rounded-md border border-lichen bg-parchment px-3 py-2 text-sm text-ink"
          />
          <button
            type="button"
            onClick={() => suggest.mutate()}
            disabled={busy || !instruction.trim()}
            className="btn-secondary mt-2 px-3 py-1.5 text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Sparkles size={15} />
            {suggest.isPending ? 'Generating…' : 'Generate'}
          </button>
        </div>

        {/* Section visibility editor */}
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <div key={group.id}>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-archive mb-2">
                {group.label}
              </h4>
              <div className="flex flex-col gap-1">
                {group.sections.map((s) => {
                  const required = isRequired(s);
                  const isHidden = hidden.has(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => !required && toggle(s.id)}
                      disabled={required}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink hover:bg-stone disabled:cursor-not-allowed text-left"
                    >
                      {isHidden && !required ? (
                        <EyeOff size={15} className="text-archive" />
                      ) : (
                        <Eye size={15} className="text-forest" />
                      )}
                      <span className={isHidden && !required ? 'text-archive line-through' : ''}>
                        {s.label}
                      </span>
                      {required && <span className="text-xs text-archive">required</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Cataloging view"
            className="w-full rounded-md border border-lichen bg-parchment px-3 py-2 text-sm text-ink"
          />
        </div>

        {error && <p className="text-sm text-semantic-error">{error}</p>}
      </div>
    </SlideOver>
  );
}
