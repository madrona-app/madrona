/**
 * Columns Block — 2 or 3 column layout with nested blocks.
 *
 * Editor: select column count, each column is a mini block list (simplified).
 * Renderer: renders columns with nested block content.
 *
 * Note: Nested blocks support only simple types (rich_text, image, quote, divider)
 * to avoid deep nesting complexity.
 */

import { useCallback } from 'react';
import { cn } from '../../../../lib/utils';
import { sanitizeRichHtml } from '../../../../lib/sanitize';

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

type ColumnCount = 2 | 3;

interface NestedBlock {
  block_type: string;
  content: Record<string, unknown>;
}

// =============================================================================
// Editor
// =============================================================================

export function ColumnsEditor({ content, onChange }: BlockEditorComponentProps) {
  const columnCount = (content.column_count as ColumnCount) ?? 2;
  const columnBlocks = (content.column_blocks as NestedBlock[][]) || initColumns(columnCount);

  const setColumnCount = useCallback(
    (count: ColumnCount) => {
      const existing = (content.column_blocks as NestedBlock[][]) || [];
      // Expand or shrink columns array
      const updated: NestedBlock[][] = [];
      for (let i = 0; i < count; i++) {
        updated.push(existing[i] || []);
      }
      onChange({ ...content, column_count: count, column_blocks: updated });
    },
    [content, onChange],
  );

  const updateColumnContent = useCallback(
    (colIndex: number, blockIndex: number, field: string, value: string) => {
      const updated = columnBlocks.map((col, ci) =>
        ci === colIndex
          ? col.map((block, bi) =>
              bi === blockIndex
                ? { ...block, content: { ...block.content, [field]: value } }
                : block,
            )
          : col,
      );
      onChange({ ...content, column_blocks: updated });
    },
    [columnBlocks, content, onChange],
  );

  const addBlockToColumn = useCallback(
    (colIndex: number) => {
      const updated = columnBlocks.map((col, ci) =>
        ci === colIndex
          ? [...col, { block_type: 'rich_text', content: { html: '' } }]
          : col,
      );
      onChange({ ...content, column_blocks: updated });
    },
    [columnBlocks, content, onChange],
  );

  const removeBlockFromColumn = useCallback(
    (colIndex: number, blockIndex: number) => {
      const updated = columnBlocks.map((col, ci) =>
        ci === colIndex ? col.filter((_, bi) => bi !== blockIndex) : col,
      );
      onChange({ ...content, column_blocks: updated });
    },
    [columnBlocks, content, onChange],
  );

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">
          Number of Columns
        </label>
        <div className="flex gap-2">
          {([2, 3] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setColumnCount(n)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-lg border transition-colors',
                columnCount === n
                  ? 'border-bark bg-bark/10 text-bark'
                  : 'border-lichen text-archive hover:border-bark hover:text-bark',
              )}
            >
              {n} Columns
            </button>
          ))}
        </div>
      </div>

      <div className={cn('grid gap-3', columnCount === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
        {columnBlocks.slice(0, columnCount).map((col, colIndex) => (
          <div key={colIndex} className="border border-lichen rounded-lg p-3 bg-stone space-y-2">
            <span className="text-xs font-medium text-archive">
              Column {colIndex + 1}
            </span>

            {col.map((block, blockIndex) => (
              <div key={blockIndex} className="relative">
                <textarea
                  value={(block.content.html as string) || ''}
                  onChange={(e) =>
                    updateColumnContent(colIndex, blockIndex, 'html', e.target.value)
                  }
                  placeholder="Enter text content..."
                  rows={3}
                  className="input w-full text-sm resize-none"
                />
                <button
                  type="button"
                  onClick={() => removeBlockFromColumn(colIndex, blockIndex)}
                  className="absolute top-1 right-1 text-xs text-archive hover:text-semantic-error"
                  title="Remove"
                >
                  &times;
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() => addBlockToColumn(colIndex)}
              className="text-xs text-archive hover:text-bark transition-colors"
            >
              + Add text block
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function initColumns(count: ColumnCount): NestedBlock[][] {
  return Array.from({ length: count }, () => []);
}

// =============================================================================
// Renderer
// =============================================================================

export function ColumnsRenderer({ content }: BlockRendererComponentProps) {
  const columnCount = (content.column_count as ColumnCount) ?? 2;
  const columnBlocks = (content.column_blocks as NestedBlock[][]) || [];

  if (columnBlocks.length === 0) return null;

  const gridCols = columnCount === 3 ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1 md:grid-cols-2';

  return (
    <div className={cn('grid gap-6', gridCols)}>
      {columnBlocks.slice(0, columnCount).map((col, colIndex) => (
        <div key={colIndex} className="space-y-4">
          {col.map((block, blockIndex) => (
            <div key={blockIndex}>
              {block.block_type === 'rich_text' && Boolean(block.content.html) && (
                <div
                  className="prose prose-sm max-w-none text-ink"
                  ref={(el) => { if (el) el.innerHTML = sanitizeRichHtml(block.content.html as string); }}
                />
              )}
              {block.block_type === 'quote' && Boolean(block.content.text) && (
                <blockquote className="border-l-4 border-bark pl-4 py-1">
                  <p className="text-sm italic text-ink">
                    &ldquo;{block.content.text as string}&rdquo;
                  </p>
                  {Boolean(block.content.attribution) && (
                    <footer className="text-xs text-archive mt-1">
                      &mdash; {block.content.attribution as string}
                    </footer>
                  )}
                </blockquote>
              )}
              {block.block_type === 'divider' && (
                <hr className="border-t border-lichen" />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
