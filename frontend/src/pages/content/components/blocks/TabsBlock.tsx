/**
 * Tabs Block — Tabbed content sections with nested blocks.
 *
 * Renderer recursively renders nested blocks within each tab using
 * a lazy-imported BlockRenderer to avoid circular dependencies.
 */

import { useState, useCallback, lazy, Suspense } from 'react';
import { Plus, Trash2, ChevronDown, GripVertical } from 'lucide-react';
import { MadronaLoader } from '../../../../components/ui/MadronaLoader';
import { cn } from '../../../../lib/utils';

// =============================================================================
// Shared Types
// =============================================================================

interface BlockEditorComponentProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

interface BlockRendererComponentProps {
  content: Record<string, unknown>;
}

interface TabItem {
  label: string;
  blocks: unknown[];
}

interface NestedBlock {
  block_type: string;
  content: Record<string, unknown>;
}

// Lazy import to avoid circular dependency with BlockRenderer
const LazyBlockRenderer = lazy(() => import('../BlockRenderer'));

// =============================================================================
// Editor
// =============================================================================

export function TabsEditor({ content, onChange }: BlockEditorComponentProps) {
  const tabs = (content.tabs as TabItem[]) || [];

  const updateTab = useCallback(
    (index: number, field: string, value: unknown) => {
      const updated = tabs.map((tab, i) =>
        i === index ? { ...tab, [field]: value } : tab,
      );
      onChange({ ...content, tabs: updated });
    },
    [tabs, content, onChange],
  );

  const addTab = useCallback(() => {
    onChange({
      ...content,
      tabs: [...tabs, { label: '', blocks: [] }],
    });
  }, [tabs, content, onChange]);

  const removeTab = useCallback(
    (index: number) => {
      onChange({ ...content, tabs: tabs.filter((_, i) => i !== index) });
    },
    [tabs, content, onChange],
  );

  const moveTab = useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= tabs.length) return;
      const updated = [...tabs];
      [updated[index], updated[target]] = [updated[target], updated[index]];
      onChange({ ...content, tabs: updated });
    },
    [tabs, content, onChange],
  );

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-ink">
        Tabs
      </label>

      {tabs.length === 0 && (
        <p className="text-sm text-archive italic">
          No tabs yet. Add one below.
        </p>
      )}

      {tabs.map((tab, index) => (
        <div
          key={index}
          className="border border-lichen rounded-lg p-3 space-y-2 bg-stone"
        >
          <div className="flex items-center gap-2">
            <GripVertical size={14} className="shrink-0 text-archive" />
            <span className="text-xs text-archive font-medium">
              Tab #{index + 1}
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => moveTab(index, -1)}
              disabled={index === 0}
              className="p-1 text-archive hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
              title="Move up"
            >
              <ChevronDown size={14} className="rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => moveTab(index, 1)}
              disabled={index === tabs.length - 1}
              className="p-1 text-archive hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
              title="Move down"
            >
              <ChevronDown size={14} />
            </button>
            <button
              type="button"
              onClick={() => removeTab(index)}
              className="p-1 text-archive hover:text-semantic-error"
              title="Remove tab"
            >
              <Trash2 size={14} />
            </button>
          </div>

          <input
            type="text"
            value={tab.label}
            onChange={(e) => updateTab(index, 'label', e.target.value)}
            placeholder="Tab label"
            className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full"
          />

          <div>
            <label className="block text-xs text-archive mb-1">
              Blocks (JSON)
            </label>
            <textarea
              value={JSON.stringify(tab.blocks || [], null, 2)}
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  if (Array.isArray(parsed)) {
                    updateTab(index, 'blocks', parsed);
                  }
                } catch {
                  // Allow typing invalid JSON while editing;
                  // store raw string temporarily so it doesn't reset the field
                }
              }}
              onBlur={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  if (Array.isArray(parsed)) {
                    updateTab(index, 'blocks', parsed);
                  }
                } catch {
                  // Reset to current valid value on blur if invalid
                  e.target.value = JSON.stringify(tab.blocks || [], null, 2);
                }
              }}
              placeholder="[]"
              rows={4}
              className="border border-lichen rounded-lg px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 w-full resize-none font-mono"
            />
            <p className="text-xs text-archive mt-1">
              Nested blocks as JSON array. A visual editor will be available in a future update.
            </p>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addTab}
        className="flex items-center gap-2 px-3 py-2 text-sm text-archive border border-dashed border-lichen rounded-lg hover:border-bark hover:text-bark transition-colors w-full"
      >
        <Plus size={14} />
        Add Tab
      </button>
    </div>
  );
}

// =============================================================================
// Renderer
// =============================================================================

export function TabsRenderer({ content }: BlockRendererComponentProps) {
  const tabs = (content.tabs as Array<{ label: string; blocks: NestedBlock[] }>) || [];
  const [activeIndex, setActiveIndex] = useState(0);

  if (tabs.length === 0) return null;

  const activeTab = tabs[activeIndex] || tabs[0];

  // Convert nested blocks into the ContentBlock shape BlockRenderer expects
  const contentBlocks = (activeTab.blocks || []).map((block, i) => ({
    block_id: `tab-${activeIndex}-block-${i}`,
    block_type: block.block_type,
    content: block.content,
    sort_order: i,
  }));

  return (
    <div>
      {/* Tab buttons */}
      <div className="flex border-b border-lichen" role="tablist">
        {tabs.map((tab, index) => (
          <button
            key={index}
            type="button"
            role="tab"
            aria-selected={index === activeIndex}
            onClick={() => setActiveIndex(index)}
            className={cn(
              'px-5 py-3 text-sm font-medium border-b-2 transition-colors -mb-px',
              index === activeIndex
                ? 'border-bark text-bark'
                : 'border-transparent text-archive hover:text-ink hover:border-lichen',
            )}
          >
            {tab.label || `Tab ${index + 1}`}
          </button>
        ))}
      </div>

      {/* Tab content — recursive block rendering */}
      <div className="pt-6">
        {contentBlocks.length > 0 ? (
          <Suspense
            fallback={
              <div className="py-4"><MadronaLoader variant="dots" /></div>
            }
          >
            <LazyBlockRenderer blocks={contentBlocks as any} />
          </Suspense>
        ) : (
          <p className="text-sm text-archive italic">No content in this tab.</p>
        )}
      </div>
    </div>
  );
}
