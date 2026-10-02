/**
 * TableOfContents — Sticky sidebar nav for the sidebar template.
 *
 * Parses <h2> and <h3> from rich_text blocks' HTML content
 * and renders an in-page navigation sidebar.
 */

import { useMemo } from 'react';
import type { ContentBlock } from '../../../types/content';

interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

interface TableOfContentsProps {
  blocks: ContentBlock[];
}

function extractHeadings(blocks: ContentBlock[]): TocEntry[] {
  const headings: TocEntry[] = [];
  const parser = typeof DOMParser !== 'undefined' ? new DOMParser() : null;

  for (const block of blocks) {
    if (block.block_type !== 'rich_text') continue;
    const html = (block.content as { html?: string })?.html;
    if (!html || !parser) continue;

    const doc = parser.parseFromString(html, 'text/html');
    const elements = doc.querySelectorAll('h2, h3');
    elements.forEach((el) => {
      const text = el.textContent?.trim();
      if (!text) return;
      const id = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s]+/g, '-')
        .slice(0, 60);
      const level = el.tagName === 'H2' ? 2 : 3;
      headings.push({ id, text, level });
    });
  }

  return headings;
}

export function TableOfContents({ blocks }: TableOfContentsProps) {
  const headings = useMemo(() => extractHeadings(blocks), [blocks]);

  if (headings.length === 0) return null;

  return (
    <nav aria-label="Table of contents" className="sticky top-24">
      <h3 className="text-xs font-semibold text-ink uppercase tracking-wide mb-3">
        On this page
      </h3>
      <ul className="space-y-1.5">
        {headings.map((h, i) => (
          <li
            key={`${h.id}-${i}`}
            className={h.level === 3 ? 'pl-3' : ''}
          >
            <a
              href={`#${h.id}`}
              className="text-sm text-archive hover:text-ink transition-colors block py-0.5"
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
