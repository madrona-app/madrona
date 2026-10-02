import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import { describe, it, expect } from 'vitest';

/**
 * No modal may put aria-hidden on an ancestor of its own dialog.
 *
 * 33 modals did. Each wrapped `role="dialog"` in a full-screen overlay carrying
 * aria-hidden="true" — intended to mark the backdrop decorative, but the backdrop
 * *was* the dialog's parent, so the whole dialog sat inside a hidden subtree. A
 * screen reader would have found nothing in it. Chrome declines to apply it and
 * says so:
 *
 *   Blocked aria-hidden on an element because its descendant retained focus.
 *
 * The dialog needs no aria-hidden anywhere: role="dialog" with aria-modal="true"
 * is what tells assistive technology to treat the rest of the page as inert.
 * Where a backdrop genuinely wants hiding, make it a sibling of the dialog and
 * put aria-hidden on that element alone — UploadFromUrlModal already does, and is
 * the pattern to copy.
 *
 * Thirty-three identical copies is a copy-paste, so this guards the shape rather
 * than the instances.
 */

const SRC = join(__dirname, '../..');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'test' || entry === 'node_modules') continue;
      out.push(...tsxFiles(full));
    } else if (entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Lines where aria-hidden sits on a non-self-closing element that contains a
 * dialog.
 *
 * Not a tag regex. An earlier version matched `<div[^>]*aria-hidden...>` and
 * missed TagDefinitionsManager, because the tag holds
 * `onClick={() => setShowForm(false)}` and the `>` of the arrow function ends
 * `[^>]*` early. JSX attributes contain `>` routinely, so the tag end is found
 * by scanning for the first `>` not preceded by `=`.
 */
function hidingWrappersAroundADialog(source: string): number[] {
  const lines: number[] = [];
  const marker = /aria-hidden=(?:"true"|\{true\})/g;

  for (const match of source.matchAll(marker)) {
    // Where does this opening tag end?
    let i = match.index! + match[0].length;
    while (i < source.length) {
      if (source[i] === '>' && source[i - 1] !== '=') break;
      i += 1;
    }
    const selfClosing = source[i - 1] === '/';
    if (selfClosing) continue; // a sibling backdrop is the correct pattern

    const after = source.slice(i, i + 2000);
    if (/role="dialog"|getModalAriaProps/.test(after)) {
      lines.push(source.slice(0, match.index).split('\n').length);
    }
  }
  return lines;
}

describe('modal accessibility', () => {
  it('never hides a dialog behind aria-hidden on an ancestor', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes('aria-hidden')) continue;
      for (const line of hidingWrappersAroundADialog(source)) {
        offenders.push(`${file.slice(SRC.length + 1)}:${line}`);
      }
    }

    expect(
      offenders,
      'aria-hidden on an element that contains role="dialog" hides the dialog from ' +
        'assistive technology. Drop it — aria-modal="true" is the mechanism — or ' +
        'move the backdrop to a sibling element as UploadFromUrlModal does:\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });
});
